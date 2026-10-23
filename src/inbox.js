import {Router} from 'express';import {z} from 'zod';import {q,audit,wrap,env} from './lib.js';import {sendText,sendTemplate} from './whatsapp.js';import {windowOpen} from './campaigns.js';
export const inboxApi=Router();const bad=(m,s=400)=>Object.assign(new Error(m),{status:s});
inboxApi.get('/conversations',wrap(async(req,res)=>{const {status,unread}=req.query;
 const {rows}=await q(`SELECT v.id,v.status,v.unread,v.last_inbound_at,v.last_activity_at,c.id contact_id,c.name,c.phone,
   (SELECT body FROM messages m WHERE m.conversation_id=v.id ORDER BY created_at DESC LIMIT 1) last_message
  FROM conversations v JOIN contacts c ON c.id=v.contact_id WHERE v.workspace_id=$1 AND ($2::text IS NULL OR v.status=$2) AND ($3::boolean IS NOT TRUE OR v.unread>0) ORDER BY v.last_activity_at DESC LIMIT 200`,[req.ws,status||null,unread==='true']);
 res.json(rows.map(r=>({...r,window_open:windowOpen(r.last_inbound_at)})))}));
inboxApi.get('/conversations/unread-count',wrap(async(req,res)=>res.json({unread:(await q('SELECT coalesce(sum(unread),0)::int n FROM conversations WHERE workspace_id=$1',[req.ws])).rows[0].n})));
inboxApi.get('/conversations/:id/messages',wrap(async(req,res)=>{
 const {rows:[v]}=await q('SELECT * FROM conversations WHERE id=$1 AND workspace_id=$2',[req.params.id,req.ws]);if(!v)throw bad('Conversation not found.',404);
 await q('UPDATE conversations SET unread=0 WHERE id=$1',[v.id]);
 const {rows}=await q('SELECT id,direction,type,body,status,error,created_at FROM messages WHERE conversation_id=$1 AND workspace_id=$2 ORDER BY created_at LIMIT 500',[v.id,req.ws]);
 res.json({window_open:windowOpen(v.last_inbound_at),window_closes_at:v.last_inbound_at?new Date(new Date(v.last_inbound_at).getTime()+864e5):null,messages:rows})}));
inboxApi.post('/conversations/:id/reply',wrap(async(req,res)=>{
 const d=z.object({text:z.string().min(1).max(4096).optional(),template_id:z.string().uuid().optional(),params:z.array(z.string()).optional()}).parse(req.body);
 const {rows:[v]}=await q(`SELECT v.*,c.phone FROM conversations v JOIN contacts c ON c.id=v.contact_id WHERE v.id=$1 AND v.workspace_id=$2`,[req.params.id,req.ws]);if(!v)throw bad('Conversation not found.',404);
 const {rows:[a]}=await q('SELECT * FROM wa_accounts WHERE id=$1',[v.wa_account_id]);if(a.status!=='active')throw bad('The sender account is not active.',409);
 let resp,text;
 if(d.template_id){const {rows:[t]}=await q('SELECT * FROM templates WHERE id=$1 AND workspace_id=$2',[d.template_id,req.ws]);if(!t||t.status!=='APPROVED')throw bad('Choose an approved template.');
  resp=await sendTemplate(a,v.phone,t.name,t.language,d.params||[]);text=`[template:${t.name}] ${(d.params||[]).join(', ')}`}
 else{if(!d.text)throw bad('Write a reply.');if(!windowOpen(v.last_inbound_at))return res.status(422).json({error:'The 24-hour reply window has closed. Send an approved template instead.',code:'WINDOW_CLOSED'}); // FR-084, BR-005
  resp=await sendText(a,v.phone,d.text);text=d.text}
 const pid=resp.messages?.[0]?.id;
 const {rows:[m]}=await q("INSERT INTO messages(workspace_id,conversation_id,wa_account_id,contact_id,direction,type,body,provider_message_id,status) VALUES($1,$2,$3,$4,'outbound',$5,$6,$7,'submitted') RETURNING id,body,status,created_at",[req.ws,v.id,a.id,v.contact_id,d.template_id?'template':'text',text,pid]);
 await q('UPDATE conversations SET last_activity_at=now() WHERE id=$1',[v.id]);res.status(201).json(m)}));
inboxApi.patch('/conversations/:id',wrap(async(req,res)=>{const s=req.body.status;if(!['open','pending','resolved'].includes(s))throw bad('Status must be open, pending or resolved.');
 const r=await q('UPDATE conversations SET status=$3 WHERE id=$1 AND workspace_id=$2',[req.params.id,req.ws,s]);r.rowCount?res.json({status:s}):res.sendStatus(404)}));
/* Audit + platform operations */
inboxApi.get('/audit',wrap(async(req,res)=>{if(req.role!=='owner')throw bad('Owner permission required.',403);res.json((await q('SELECT action,detail,created_at FROM audit_logs WHERE workspace_id=$1 ORDER BY id DESC LIMIT 200',[req.ws])).rows)}));
inboxApi.get('/admin/metrics',wrap(async(req,res)=>{if(!req.user.is_platform_admin)throw bad('Platform admin only.',403);
 const g=async s=>(await q(s)).rows;res.json({queue:await g("SELECT status,count(*)::int n FROM campaign_recipients WHERE status IN('queued','processing') GROUP BY status"),
  stuck:(await g("SELECT count(*)::int n FROM campaign_recipients WHERE status='processing' AND claimed_at<now()-interval '5 minutes'"))[0].n,
  webhook_errors_24h:(await g("SELECT count(*)::int n FROM webhook_events WHERE error IS NOT NULL AND received_at>now()-interval '24 hours'"))[0].n,
  unprocessed_webhooks:(await g("SELECT count(*)::int n FROM webhook_events WHERE processed_at IS NULL AND error IS NULL AND received_at<now()-interval '2 minutes'"))[0].n,
  restricted_senders:(await g("SELECT count(*)::int n FROM wa_accounts WHERE status<>'active'"))[0].n})}));
