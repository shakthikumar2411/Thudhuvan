import {Router} from 'express';import {z} from 'zod';import {q,audit,wrap} from './lib.js';import {entitlement} from './billing.js';
export const campaignsApi=Router();
const bad=(m,s=400)=>Object.assign(new Error(m),{status:s});
const body=(s,b)=>{const r=s.safeParse(b);if(!r.success)throw bad(r.error.issues[0].message);return r.data};
export const field=(c,k)=>{const v=c[k]??c.attrs?.[k];return v==null||v===''?null:String(v)};
export const fill=(t,c)=>t.replace(/\{\{(\w+)\}\}/g,(_,k)=>field(c,k)??'');
export const needsVars=t=>[...new Set([...(t||'').matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]))];
export const windowOpen=d=>d&&Date.now()-new Date(d).getTime()<864e5;
const tplBody=t=>(t.components||[]).find(c=>c.type==='BODY')?.text||'';
const tplHasMediaHeader=t=>(t.components||[]).some(c=>c.type==='HEADER'&&c.format&&c.format!=='TEXT');
/* Validate a campaign and split its audience into eligible/excluded (FR-057..059, BR-001..005) */
export async function evaluate(ws,k){
 const errors=[],{rows:[acc]}=await q('SELECT id,status FROM wa_accounts WHERE id=$1 AND workspace_id=$2',[k.wa_account_id,ws]);
 if(!acc)errors.push('Choose a connected WhatsApp sender.');else if(acc.status!=='active')errors.push(`Sender is ${acc.status}. It must be active to send.`);
 let tpl=null;
 if(k.type==='template'){({rows:[tpl]}=await q('SELECT * FROM templates WHERE id=$1 AND workspace_id=$2',[k.template_id,ws]));
  if(!tpl)errors.push('Choose a template.');else{if(tpl.status!=='APPROVED')errors.push(`Template "${tpl.name}" is ${tpl.status}. Only approved templates can be sent.`);
   if(tplHasMediaHeader(tpl))errors.push('Templates with image, video or document headers are not supported yet.');
   const n=new Set((tplBody(tpl).match(/\{\{\d+\}\}/g)||[])).size;if((k.params||[]).length!==n)errors.push(`This template needs ${n} variable(s); ${(k.params||[]).length} mapped.`)}}
 else{if(!k.body?.trim())errors.push('Write a message.');if(k.type==='image'&&!/^https:\/\/.+\.(png|jpe?g)(\?.*)?$/i.test(k.media_url||''))errors.push('Poster needs an https link to a PNG or JPG.')}
 const a=k.audience||{};
 const {rows:cs}=await q(`SELECT c.*,EXISTS(SELECT 1 FROM suppressions s WHERE s.workspace_id=c.workspace_id AND s.phone=c.phone) AS suppressed,
   (SELECT max(last_inbound_at) FROM conversations v WHERE v.contact_id=c.id AND v.wa_account_id=$3) AS last_inbound
  FROM contacts c WHERE c.workspace_id=$1 AND (c.id=ANY($2::uuid[]) OR c.id IN(SELECT contact_id FROM group_members WHERE group_id=ANY($4::uuid[])))`,
  [ws,a.contact_ids||[],k.wa_account_id||null,a.group_ids||[]]);
 const eligible=[],excluded=[];
 for(const c of cs){let r=null;
  if(c.suppressed)r='Opted out';else if(c.consent_status!=='opted_in')r='No marketing consent';
  else if(k.type!=='template'&&!windowOpen(c.last_inbound))r='Outside 24h window: use a template';
  else{const names=k.type==='template'?k.params:needsVars(k.body);const miss=names.find(n=>!field(c,n));if(miss)r=`Missing "${miss}"`}
  r?excluded.push({contact_id:c.id,phone:c.phone,reason:r}):eligible.push(c)}
 if(!cs.length)errors.push('Select at least one group or contact.');else if(!eligible.length)errors.push('No eligible recipients.');
 const reasons={};excluded.forEach(e=>reasons[e.reason]=(reasons[e.reason]||0)+1);
 return {errors,eligible,excluded,reasons,tpl,acc};
}
const getK=async(ws,id)=>{const {rows:[k]}=await q('SELECT * FROM campaigns WHERE id=$1 AND workspace_id=$2',[id,ws]);if(!k)throw bad('Campaign not found.',404);return k};
campaignsApi.post('/campaigns',wrap(async(req,res)=>{
 const d=body(z.object({name:z.string().min(2),wa_account_id:z.string().uuid(),type:z.enum(['text','image','template']),body:z.string().max(1024).optional(),template_id:z.string().uuid().optional(),
  params:z.array(z.string()).optional(),media_url:z.string().url().optional(),group_ids:z.array(z.string().uuid()).optional(),contact_ids:z.array(z.string().uuid()).optional(),scheduled_at:z.string().datetime().optional()}),req.body);
 const {rows:[k]}=await q(`INSERT INTO campaigns(workspace_id,wa_account_id,name,type,body,template_id,params,media_url,audience,scheduled_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
  [req.ws,d.wa_account_id,d.name,d.type,d.body,d.template_id,JSON.stringify(d.params||[]),d.media_url,JSON.stringify({group_ids:d.group_ids||[],contact_ids:d.contact_ids||[]}),d.scheduled_at,req.user.id]);
 await audit(req.ws,req.user.id,'campaign.create',{id:k.id});res.status(201).json(k)}));
campaignsApi.get('/campaigns',wrap(async(req,res)=>res.json((await q(`SELECT k.id,k.name,k.type,k.status,k.scheduled_at,k.created_at,
  count(r.*)::int total,count(*) FILTER(WHERE r.status IN('submitted','sent','delivered','read'))::int submitted,count(*) FILTER(WHERE r.status IN('delivered','read'))::int delivered,
  count(*) FILTER(WHERE r.status='read')::int read,count(*) FILTER(WHERE r.status='failed')::int failed
  FROM campaigns k LEFT JOIN campaign_recipients r ON r.campaign_id=k.id WHERE k.workspace_id=$1 GROUP BY k.id ORDER BY k.created_at DESC`,[req.ws])).rows)));
campaignsApi.post('/campaigns/:id/preview',wrap(async(req,res)=>{const k=await getK(req.ws,req.params.id);const e=await evaluate(req.ws,k);
 const E=await entitlement(req.ws);res.json({quota:{used:E.usage.messages,limit:E.limits.monthly_messages,after:E.usage.messages+e.eligible.length,blocked:!E.canSend,message:E.message},errors:e.errors,eligible:e.eligible.length,excluded:e.excluded.length,reasons:e.reasons,sample:e.eligible.slice(0,3).map(c=>({phone:c.phone,message:k.type==='template'?undefined:fill(k.body||'',c)}))})}));
campaignsApi.post('/campaigns/:id/launch',wrap(async(req,res)=>{ // BR-010 explicit confirmation
 if(req.body.confirm!==true)throw bad('Confirm the send explicitly with {"confirm":true}.');
 const k=await getK(req.ws,req.params.id);if(k.status!=='draft')throw bad(`This campaign is already ${k.status}.`,409);
 const e=await evaluate(req.ws,k);if(e.errors.length)return res.status(422).json({errors:e.errors});
 const E=await entitlement(req.ws);if(!E.canSend)throw bad(E.message,402);
 if(E.usage.messages+e.eligible.length>E.limits.monthly_messages)throw bad(`This campaign needs ${e.eligible.length} messages but your plan has ${Math.max(0,E.limits.monthly_messages-E.usage.messages)} left this period. Upgrade your plan or choose a smaller audience.`,402);
 const sched=k.scheduled_at&&new Date(k.scheduled_at)>new Date();
 const up=await q("UPDATE campaigns SET status=$3 WHERE id=$1 AND workspace_id=$2 AND status='draft' RETURNING id",[k.id,req.ws,sched?'scheduled':'queued']);
 if(!up.rowCount)throw bad('This campaign was already launched.',409); // double-click guard (FR-067)
 await q(`INSERT INTO campaign_recipients(workspace_id,campaign_id,contact_id,phone) SELECT $1,$2,c,p FROM unnest($3::uuid[],$4::text[]) AS t(c,p) ON CONFLICT DO NOTHING`,[req.ws,k.id,e.eligible.map(c=>c.id),e.eligible.map(c=>c.phone)]);
 await audit(req.ws,req.user.id,'campaign.launch',{id:k.id,recipients:e.eligible.length,excluded:e.excluded.length});
 res.json({status:sched?'scheduled':'queued',recipients:e.eligible.length,excluded:e.excluded.length,reasons:e.reasons})}));
const setStatus=(from,to,act)=>wrap(async(req,res)=>{const r=await q('UPDATE campaigns SET status=$4,paused_reason=NULL WHERE id=$1 AND workspace_id=$2 AND status=ANY($3) RETURNING id',[req.params.id,req.ws,from,to]);
 if(!r.rowCount)throw bad('This action is not available in the campaign\'s current state.',409);
 if(to==='cancelled')await q("UPDATE campaign_recipients SET status='cancelled',error_text='Cancelled before sending' WHERE campaign_id=$1 AND status='queued'",[req.params.id]); // BR-011: submitted messages are not withdrawn
 await audit(req.ws,req.user.id,'campaign.'+act,{id:req.params.id});res.json({status:to})});
campaignsApi.post('/campaigns/:id/pause',setStatus(['queued','sending','scheduled'],'paused','pause'));
campaignsApi.post('/campaigns/:id/resume',setStatus(['paused'],'queued','resume'));
campaignsApi.post('/campaigns/:id/cancel',setStatus(['queued','sending','scheduled','paused'],'cancelled','cancel'));
campaignsApi.post('/campaigns/:id/retry-failed',wrap(async(req,res)=>{await getK(req.ws,req.params.id); // only interrupted/exhausted-temporary, never permanent failures
 const r=await q("UPDATE campaign_recipients SET status='queued',attempts=0,next_attempt_at=now(),error_code=NULL,error_text=NULL WHERE campaign_id=$1 AND workspace_id=$2 AND status='failed' AND error_code IN('INTERRUPTED','TEMPORARY_EXHAUSTED')",[req.params.id,req.ws]);
 if(r.rowCount)await q("UPDATE campaigns SET status='queued' WHERE id=$1 AND status IN('completed','completed_with_errors')",[req.params.id]);res.json({requeued:r.rowCount})}));
campaignsApi.get('/campaigns/:id',wrap(async(req,res)=>{const k=await getK(req.ws,req.params.id);
 const {rows}=await q('SELECT status,count(*)::int n FROM campaign_recipients WHERE campaign_id=$1 GROUP BY status',[k.id]);
 const {rows:fails}=await q("SELECT coalesce(error_code,'unknown') code,coalesce(error_text,'') text,count(*)::int n FROM campaign_recipients WHERE campaign_id=$1 AND status='failed' GROUP BY 1,2 ORDER BY n DESC",[k.id]);
 const by=Object.fromEntries(rows.map(r=>[r.status,r.n])),sub=['submitted','sent','delivered','read'].reduce((a,s)=>a+(by[s]||0),0),del=(by.delivered||0)+(by.read||0);
 res.json({campaign:k,counts:by,submitted:sub,delivery_rate:sub?+(del/sub*100).toFixed(1):null,read_rate:del?+((by.read||0)/del*100).toFixed(1):null,failures:fails})})); // rates use submitted as denominator; null = not enough data
campaignsApi.get('/campaigns/:id/recipients',wrap(async(req,res)=>{await getK(req.ws,req.params.id);const s=req.query.status;
 res.json((await q(`SELECT r.phone,c.name,r.status,r.error_code,r.error_text,r.sent_at,r.delivered_at,r.read_at FROM campaign_recipients r LEFT JOIN contacts c ON c.id=r.contact_id WHERE r.campaign_id=$1 AND ($2::text IS NULL OR r.status=$2) ORDER BY r.phone LIMIT 1000`,[req.params.id,s||null])).rows)}));
campaignsApi.get('/campaigns/:id/export.csv',wrap(async(req,res)=>{await getK(req.ws,req.params.id);
 const {rows}=await q('SELECT phone,status,error_code,error_text,sent_at,delivered_at,read_at FROM campaign_recipients WHERE campaign_id=$1 ORDER BY phone',[req.params.id]);
 const esc=v=>v==null?'':`"${String(v instanceof Date?v.toISOString():v).replace(/"/g,'""').replace(/^([=+\-@])/,"'$1")}"`; // neutralise CSV formula injection
 res.type('text/csv').send(['phone,status,error_code,error_text,sent_at,delivered_at,read_at',...rows.map(r=>Object.values(r).map(esc).join(','))].join('\n'))}));
