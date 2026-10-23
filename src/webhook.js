import {Router} from 'express';import crypto from 'crypto';import {q,env,normPhone} from './lib.js';import {verifySignature} from './whatsapp.js';
export const webhook=Router();
webhook.get('/',(req,res)=>req.query['hub.verify_token']===env.META_VERIFY_TOKEN&&req.query['hub.mode']==='subscribe'?res.send(req.query['hub.challenge']):res.sendStatus(403));
webhook.post('/',(req,res)=>{
 if(!verifySignature(req.rawBody,req.headers['x-hub-signature-256']))return res.sendStatus(401);
 res.sendStatus(200); // acknowledge fast; process asynchronously (10.4)
 setImmediate(()=>processPayload(req.body).catch(e=>console.error('webhook',e)));});
async function processPayload(body){
 for(const entry of body.entry||[])for(const ch of entry.changes||[]){
  const v=ch.value||{},pid=v.metadata?.phone_number_id;
  const id=crypto.createHash('sha256').update(JSON.stringify({pid,m:v.messages,s:v.statuses})).digest('hex'); // deterministic dedupe key
  const ins=await q('INSERT INTO webhook_events(event_id,payload) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id',[id,v]);
  if(!ins.rowCount)continue; // duplicate delivery (FR-090)
  await handle(id,v)}}
export async function handle(id,v){const pid=v.metadata?.phone_number_id;
 try{const {rows:[acc]}=await q('SELECT id,workspace_id FROM wa_accounts WHERE phone_number_id=$1',[pid]);
  if(!acc)throw new Error('Unknown phone_number_id '+pid);
  for(const m of v.messages||[])await inbound(acc,m,v.contacts?.[0]);
  for(const s of v.statuses||[])await status(acc,s);
  await q('UPDATE webhook_events SET processed_at=now(),error=NULL WHERE event_id=$1',[id])}
 catch(e){await q('UPDATE webhook_events SET error=$2 WHERE event_id=$1',[id,e.message])}}
// Retry events that failed (e.g. number connected after the first webhook); handlers are idempotent
export async function reprocessWebhooks(){const {rows}=await q("UPDATE webhook_events SET retries=retries+1 WHERE event_id IN(SELECT event_id FROM webhook_events WHERE processed_at IS NULL AND retries<5 AND received_at<now()-interval '1 minute' ORDER BY received_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING event_id,payload");
 for(const r of rows)await handle(r.event_id,r.payload);return rows.length}
async function inbound(acc,m,prof){
 const phone=m.from,ws=acc.workspace_id;
 let {rows:[c]}=await q('SELECT id FROM contacts WHERE workspace_id=$1 AND phone=$2',[ws,phone]);
 if(!c)({rows:[c]}=await q("INSERT INTO contacts(workspace_id,phone,name) VALUES($1,$2,$3) ON CONFLICT(workspace_id,phone) DO UPDATE SET phone=EXCLUDED.phone RETURNING id",[ws,phone,prof?.profile?.name||null])); // inbound contact is NOT marketing-consented
 const text=m.text?.body||m.button?.text||m.interactive?.button_reply?.title||`[${m.type}]`;
 const {rows:[cv]}=await q(`INSERT INTO conversations(workspace_id,wa_account_id,contact_id,unread,last_inbound_at,last_activity_at) VALUES($1,$2,$3,1,now(),now())
  ON CONFLICT(wa_account_id,contact_id) DO UPDATE SET unread=conversations.unread+1,last_inbound_at=now(),last_activity_at=now(),status=CASE WHEN conversations.status='resolved' THEN 'open' ELSE conversations.status END RETURNING id`,[ws,acc.id,c.id]);
 const ins=await q(`INSERT INTO messages(workspace_id,conversation_id,wa_account_id,contact_id,direction,type,body,provider_message_id,status) VALUES($1,$2,$3,$4,'inbound',$5,$6,$7,'received') ON CONFLICT(provider_message_id) DO NOTHING`,[ws,cv.id,acc.id,c.id,m.type,text,m.id]);
 if(ins.rowCount&&/^\s*(stop|unsubscribe|opt.?out|cancel)\s*$/i.test(text)){ // FR-040
  await q('INSERT INTO suppressions(workspace_id,phone,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[ws,phone,'keyword:'+text.trim()]);
  await q("UPDATE contacts SET consent_status='none' WHERE id=$1",[c.id]);
  await q("INSERT INTO consent_records(workspace_id,contact_id,action,source,evidence) VALUES($1,$2,'opt_out','whatsapp_keyword',$3)",[ws,c.id,text])}}
const RANK={queued:0,submitted:1,sent:2,delivered:3,read:4,failed:5};
async function status(acc,s){const st=s.status,ts=new Date(s.timestamp*1000),err=s.errors?.[0];
 await q(`UPDATE messages SET status=$2,error=$3 WHERE provider_message_id=$1 AND workspace_id=$4`,[s.id,st,err?`${err.code}: ${err.title}`:null,acc.workspace_id]);
 // never move backwards (out-of-order webhooks)
 await q(`UPDATE campaign_recipients SET status=$2,
   delivered_at=CASE WHEN $2='delivered' THEN $3 ELSE delivered_at END,read_at=CASE WHEN $2='read' THEN $3 ELSE read_at END,
   error_code=$4,error_text=$5
  WHERE provider_message_id=$1 AND workspace_id=$6 AND COALESCE(($7::jsonb->>status)::int,0)<COALESCE(($7::jsonb->>$2)::int,0)`,
  [s.id,st,ts,err?.code?String(err.code):null,err?.title||null,acc.workspace_id,JSON.stringify(RANK)])}
