import {q,pool} from './lib.js';import {sendText,sendTemplate,sendImage} from './whatsapp.js';import {reprocessWebhooks} from './webhook.js';import {fill,field,windowOpen} from './campaigns.js';
const RATE=+process.env.WORKER_RATE||10,MAX_TRIES=5,backoffUntil=new Map(); // per-account pause after provider rate limit
async function claim(){const {rows}=await pool.query(`WITH c AS(SELECT r.id FROM campaign_recipients r JOIN campaigns k ON k.id=r.campaign_id WHERE r.status='queued' AND r.next_attempt_at<=now() AND k.status IN('queued','sending')
  ORDER BY r.next_attempt_at LIMIT $1 FOR UPDATE OF r SKIP LOCKED) UPDATE campaign_recipients r SET status='processing',claimed_at=now() FROM c WHERE r.id=c.id RETURNING r.*`,[RATE]);return rows}
async function one(r,cache){
 const k=cache.k[r.campaign_id]??=(await q('SELECT * FROM campaigns WHERE id=$1',[r.campaign_id])).rows[0];
 const live=(await q('SELECT status FROM campaigns WHERE id=$1',[k.id])).rows[0]?.status;
 if(!['queued','sending'].includes(live))return q("UPDATE campaign_recipients SET status='queued',claimed_at=NULL WHERE id=$1 AND status='processing'",[r.id]); // paused/cancelled mid-batch
 const a=cache.a[k.wa_account_id]??=(await q('SELECT * FROM wa_accounts WHERE id=$1',[k.wa_account_id])).rows[0];
 const until=backoffUntil.get(a.id);if(until>Date.now())return q("UPDATE campaign_recipients SET status='queued',claimed_at=NULL,next_attempt_at=$2 WHERE id=$1",[r.id,new Date(until)]);
 const skip=m=>q("UPDATE campaign_recipients SET status='cancelled',error_text=$2 WHERE id=$1",[r.id,'Excluded at send time: '+m]);
 if(a.status!=='active'){await q("UPDATE campaigns SET status='paused',paused_reason='Sender unavailable' WHERE id=$1 AND status IN('queued','sending')",[k.id]);return q("UPDATE campaign_recipients SET status='queued',claimed_at=NULL WHERE id=$1",[r.id])}
 // FR-041: suppression and consent are re-checked at execution time
 const {rows:[c]}=await q(`SELECT c.*,EXISTS(SELECT 1 FROM suppressions s WHERE s.workspace_id=c.workspace_id AND s.phone=c.phone) sup,(SELECT max(last_inbound_at) FROM conversations v WHERE v.contact_id=c.id AND v.wa_account_id=$2) li FROM contacts c WHERE c.id=$1`,[r.contact_id,a.id]);
 if(!c)return skip('contact deleted');if(c.sup)return skip('opted out');if(c.consent_status!=='opted_in')return skip('consent withdrawn');
 try{let resp,text;
  if(k.type==='template'){const {rows:[t]}=await q('SELECT * FROM templates WHERE id=$1',[k.template_id]);if(!t||t.status!=='APPROVED')return skip('template no longer approved');
   const params=k.params.map(n=>field(c,n));if(params.some(p=>!p))return skip('missing template value');text=`[template:${t.name}] ${params.join(', ')}`;resp=await sendTemplate(a,c.phone,t.name,t.language,params)}
  else{if(!windowOpen(c.li))return skip('24h window closed');text=fill(k.body||'',c);resp=k.type==='image'?await sendImage(a,c.phone,k.media_url,text):await sendText(a,c.phone,text)}
  const pid=resp.messages?.[0]?.id;
  await q("UPDATE campaign_recipients SET status='submitted',provider_message_id=$2,sent_at=now(),attempts=attempts+1,error_code=NULL,error_text=NULL WHERE id=$1",[r.id,pid]);
  const {rows:[cv]}=await q('INSERT INTO conversations(workspace_id,wa_account_id,contact_id) VALUES($1,$2,$3) ON CONFLICT(wa_account_id,contact_id) DO UPDATE SET last_activity_at=now() RETURNING id',[r.workspace_id,a.id,c.id]);
  await q("INSERT INTO messages(workspace_id,conversation_id,wa_account_id,contact_id,direction,type,body,provider_message_id,status,campaign_recipient_id) VALUES($1,$2,$3,$4,'outbound',$5,$6,$7,'submitted',$8) ON CONFLICT DO NOTHING",[r.workspace_id,cv.id,a.id,c.id,k.type,text,pid,r.id]);
 }catch(e){
  if(e.code===130429||e.code===80007){backoffUntil.set(a.id,Date.now()+6e4);return q("UPDATE campaign_recipients SET status='queued',claimed_at=NULL,next_attempt_at=now()+interval '60 seconds' WHERE id=$1",[r.id])} // FR/13.4: slow down, don't burn retries
  if([190,131031,368].includes(e.code)){await q("UPDATE wa_accounts SET status='restricted' WHERE id=$1",[a.id]);cache.a[a.id]=null;
   await q("UPDATE campaigns SET status='paused',paused_reason=$2 WHERE wa_account_id=$1 AND status IN('queued','sending')",[a.id,'Sender error '+e.code]);return q("UPDATE campaign_recipients SET status='queued',claimed_at=NULL WHERE id=$1",[r.id])}
  if(e.temporary){const n=r.attempts+1;return n>=MAX_TRIES?q("UPDATE campaign_recipients SET status='failed',attempts=$2,error_code='TEMPORARY_EXHAUSTED',error_text=$3 WHERE id=$1",[r.id,n,e.message]):
   q("UPDATE campaign_recipients SET status='queued',claimed_at=NULL,attempts=$2,next_attempt_at=now()+($3||' seconds')::interval,error_text=$4 WHERE id=$1",[r.id,n,String(30*2**n),e.message])} // exponential backoff
  await q("UPDATE campaign_recipients SET status='failed',attempts=attempts+1,error_code=$2,error_text=$3 WHERE id=$1",[r.id,String(e.code||'PERMANENT'),e.message]); // no retry for permanent errors
 }}
export async function tick(){
 await q("UPDATE campaigns SET status='queued' WHERE status='scheduled' AND scheduled_at<=now()");
 await q("UPDATE campaign_recipients SET status='failed',error_code='INTERRUPTED',error_text='Worker stopped mid-send; verify before retrying' WHERE status='processing' AND claimed_at<now()-interval '10 minutes'"); // recover without risking duplicates (NFR-009)
 const rows=await claim(),cache={k:{},a:{}};
 if(rows.length)await q("UPDATE campaigns SET status='sending' WHERE id=ANY($1) AND status='queued'",[[...new Set(rows.map(r=>r.campaign_id))]]);
 await Promise.all(rows.map(r=>one(r,cache).catch(async e=>{console.error('worker',e);await q("UPDATE campaign_recipients SET status='queued',claimed_at=NULL,next_attempt_at=now()+interval '1 minute' WHERE id=$1 AND status='processing'",[r.id])})));
 await q(`UPDATE campaigns k SET status=CASE WHEN EXISTS(SELECT 1 FROM campaign_recipients WHERE campaign_id=k.id AND status='failed') THEN 'completed_with_errors' ELSE 'completed' END
  WHERE k.status IN('queued','sending') AND NOT EXISTS(SELECT 1 FROM campaign_recipients WHERE campaign_id=k.id AND status IN('queued','processing'))`);} // completion from recipient states (FR-077)
export function startWorker(){if(process.env.WORKER_ENABLED==='false')return async()=>{};let busy=false,n=0;
 const t=setInterval(async()=>{if(busy)return;busy=true;try{await tick();if(++n%60===0)await reprocessWebhooks()}catch(e){console.error('tick',e.message)}busy=false},1000);
 console.log('Campaign worker running, rate',RATE,'msg/s');
 return async()=>{clearInterval(t);for(let i=0;i<100&&busy;i++)await new Promise(r=>setTimeout(r,100))}} // lets the current batch finish on shutdown
