import EP from 'embedded-postgres';import fs from 'fs';import crypto from 'crypto';
const pg=new EP({databaseDir:'/tmp/thudhuvan-test-pg',user:'t',password:'t',port:54329,persistent:false,createPostgresUser:true});
await pg.initialise();await pg.start();await pg.createDatabase('t');
Object.assign(process.env,{DATABASE_URL:'postgres://t:t@localhost:54329/t',APP_URL:'http://app.test',JWT_SECRET:'x',ENCRYPTION_KEY:'a'.repeat(64),DEFAULT_COUNTRY:'IN',WORKER_ENABLED:'false',NODE_ENV:'test',META_APP_SECRET:'sec'});
const H='./';const L=await import(H+'src/lib.js');const S=fs.readFileSync(H+'schema.sql','utf8');await L.pool.query(S);await L.pool.query(S);console.log('PASS schema (idempotent)');
const real=globalThis.fetch;let n=0;const sends=[];
globalThis.fetch=async(u,o)=>{if(!String(u).includes('graph.facebook.com'))return real(u,o);const b=JSON.parse(o?.body||'{}');
 if(String(u).includes('/messages')){n++;sends.push(b.to);const E=(s,c,m)=>({ok:false,status:s,json:async()=>({error:{code:c,message:m}})});
  if(b.to==='919000000003')return E(400,131026,'undeliverable');if(b.to==='919000000004'&&(globalThis.t4=(globalThis.t4||0)+1)<=2)return E(500,2,'temp');return{ok:true,status:200,json:async()=>({messages:[{id:'wamid.'+n}]})}}
 return{ok:true,status:200,json:async()=>({display_phone_number:'+91 90000 00000',verified_name:'Test',code_verification_status:'VERIFIED'})}};
const {default:express}=await import(H+'node_modules/express/index.js');const {api}=await import(H+'src/routes.js');const {webhook}=await import(H+'src/webhook.js');const {tick}=await import(H+'src/worker.js');
const app=express();app.use(express.json({verify:(r,_,b)=>r.rawBody=b}));app.use('/webhooks/whatsapp',webhook);app.use('/api',api);
app.use((e,_q,res,_n)=>res.status(e.status||500).json({error:e.message}));app.listen(54330);
const B='http://localhost:54330';
const f=async(p,m='GET',b,t)=>{const r=await real(B+p,{method:m,headers:{'content-type':'application/json',...(t&&{authorization:'Bearer '+t})},body:b?JSON.stringify(b):undefined});return{s:r.status,j:await r.json().catch(()=>null)}};
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
async function user(e,w){const r=await f('/api/auth/register','POST',{email:e,password:'password1',workspace:w});
 ok(r.s===201,'register '+e);const t=new URL(r.j.dev_verify_link).searchParams.get('token');
 ok((await f('/api/auth/login','POST',{email:e,password:'password1'})).s===403,'login blocked before verify');
 await f('/api/auth/verify','POST',{token:t});const l=await f('/api/auth/login','POST',{email:e,password:'password1'});ok(l.s===200,'login after verify');return l.j.token}
const A=await user('a@x.com','Biz A'),Bt=await user('b@x.com','Biz B');
let r=await f('/api/whatsapp/connect','POST',{waba_id:'w1',phone_number_id:'p1',access_token:'x'.repeat(30)},A);ok(r.s===201,'connect sender');const acc=r.j.id;
ok((await f('/api/whatsapp/accounts','GET',null,A)).j[0].token_enc===undefined,'token not exposed');
ok((await f('/api/whatsapp/connect','POST',{waba_id:'w1',phone_number_id:'p1',access_token:'y'.repeat(30)},Bt)).s===409,'number cannot be claimed by another workspace');
const ph=['9000000001','9000000002','9000000003','9000000004','9000000005','9000000006'];
for(const p of ph)await f('/api/contacts','POST',{phone:p,name:'N'+p},A);
const cs=(await f('/api/contacts','GET',null,A)).j;ok(cs.length===6,'6 contacts');
ok((await f('/api/contacts/'+cs[0].id,'GET',null,Bt)).s!==200,'B cannot read A contact');
ok((await f('/api/contacts/'+cs[0].id,'DELETE',null,Bt)).s===404,'B cannot delete A contact (isolation)');
for(const c of cs.slice(0,5))await f(`/api/contacts/${c.id}/consent`,'POST',{source:'web form'},A); // 6th has no consent
await f(`/api/contacts/${cs[1].id}/opt-out`,'POST',{},A); // opted out
await L.q("INSERT INTO templates(workspace_id,wa_account_id,name,language,status,components) SELECT workspace_id,id,'promo','en','APPROVED','[{\"type\":\"BODY\",\"text\":\"Hi {{1}}\"}]' FROM wa_accounts");
const tpl=(await f('/api/templates','GET',null,A)).j[0].id;const g=(await f('/api/groups','POST',{name:'all'},A)).j.id;await f(`/api/groups/${g}/members`,'POST',{contact_ids:cs.map(c=>c.id)},A);
const mk=async x=>(await f('/api/campaigns','POST',{name:'Camp',wa_account_id:acc,group_ids:[g],...x},A)).j;
let k=await mk({type:'text',body:'Hello {{name}}'});let pv=await f(`/api/campaigns/${k.id}/preview`,'POST',null,A);
ok(pv.j.eligible===0&&pv.j.reasons['Outside 24h window: use a template']===4,'text campaign blocked outside 24h window: '+JSON.stringify(pv.j.reasons));
k=await mk({type:'template',template_id:tpl,params:['name']});pv=await f(`/api/campaigns/${k.id}/preview`,'POST',null,A);
ok(pv.j.eligible===4&&pv.j.reasons['Opted out']===1&&pv.j.reasons['No marketing consent']===1,'template preview: 4 eligible, 1 opted out, 1 no consent');
ok((await f(`/api/campaigns/${k.id}/launch`,'POST',{},A)).s===400,'launch needs explicit confirm');
ok((await f(`/api/campaigns/${k.id}/launch`,'POST',{confirm:true},A)).s===200,'launch');ok((await f(`/api/campaigns/${k.id}/launch`,'POST',{confirm:true},A)).s===409,'double launch rejected');
await L.q("UPDATE contacts SET consent_status='none' WHERE phone='919000000006'"); // consent withdrawn AFTER launch
for(let i=0;i<4;i++)await tick();
await L.q("UPDATE campaign_recipients SET next_attempt_at=now()");for(let i=0;i<6;i++){await tick();await L.q("UPDATE campaign_recipients SET next_attempt_at=now() WHERE status='queued'")}
const d=(await f('/api/campaigns/'+k.id,'GET',null,A)).j;console.log(JSON.stringify(d.counts),d.campaign.status);
ok(d.counts.cancelled===1&&d.counts.failed===1&&d.counts.submitted===2,'suppression/consent re-checked at send time (1 cancelled)');ok(d.counts.failed===1&&d.failures.some(x=>x.code==='131026'),'permanent error recorded, not retried');
ok(d.counts.submitted===2,'2 submitted incl. one that retried after temp errors');ok(d.campaign.status==='completed_with_errors','completion from recipient states');
const before=sends.length;await tick();await tick();ok(sends.length===before,'no resend of completed recipients');
// webhook
const pid=(await L.q("SELECT provider_message_id p FROM campaign_recipients WHERE status='submitted' LIMIT 1")).rows[0].p;
const post=(body,sig)=>{const raw=JSON.stringify(body);return real(B+'/webhooks/whatsapp',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':sig??'sha256='+crypto.createHmac('sha256','sec').update(raw).digest('hex')},body:raw}).then(r=>r.status)};
const ev=(v)=>({entry:[{changes:[{value:{metadata:{phone_number_id:'p1'},...v}}]}]});
ok(await post(ev({}),'sha256=bad')===401,'bad webhook signature rejected');
const st=ev({statuses:[{id:pid,status:'read',timestamp:1700000000}]});ok(await post(st)===200,'status webhook');await new Promise(r=>setTimeout(r,300));
await post(ev({statuses:[{id:pid,status:'delivered',timestamp:1700000001}]}));await new Promise(r=>setTimeout(r,300));
ok((await L.q('SELECT status FROM campaign_recipients WHERE provider_message_id=$1',[pid])).rows[0].status==='read','out-of-order status does not move backwards');
const inb=ev({contacts:[{profile:{name:'Z'}}],messages:[{from:'919000000001',id:'wamid.in1',type:'text',text:{body:'hi there'}}]});
await post(inb);await post(inb);await new Promise(r=>setTimeout(r,400));
ok((await L.q("SELECT count(*)::int n FROM messages WHERE provider_message_id='wamid.in1'")).rows[0].n===1,'duplicate inbound webhook stored once');
const cv=(await f('/api/conversations','GET',null,A)).j;const c1=cv.find(c=>c.phone==='919000000001');ok(c1&&c1.unread===1&&c1.window_open,'inbound -> conversation, unread=1, window open');
ok((await f('/api/conversations','GET',null,Bt)).j.length===0,'B inbox empty (isolation)');
ok((await f(`/api/conversations/${c1.id}/reply`,'POST',{text:'thanks'},A)).s===201,'reply inside window');
await L.q("UPDATE conversations SET last_inbound_at=now()-interval '25 hours'");
const late=await f(`/api/conversations/${c1.id}/reply`,'POST',{text:'late'},A);ok(late.s===422&&late.j.code==='WINDOW_CLOSED','free-form reply blocked after 24h');
ok((await f(`/api/conversations/${c1.id}/reply`,'POST',{template_id:tpl,params:['Z']},A)).s===201,'template reply allowed after 24h');
await post(ev({messages:[{from:'919000000002',id:'wamid.stop',type:'text',text:{body:'STOP'}}]}));await new Promise(r=>setTimeout(r,300));
ok((await L.q("SELECT count(*)::int n FROM suppressions WHERE phone='919000000002'")).rows[0].n===1,'STOP keyword -> suppression');
// pause/cancel
k=await mk({type:'template',template_id:tpl,params:['name']});await L.q("UPDATE contacts SET consent_status='opted_in' WHERE phone='919000000005'");
await f(`/api/campaigns/${k.id}/launch`,'POST',{confirm:true},A);await f(`/api/campaigns/${k.id}/pause`,'POST',{},A);const s0=sends.length;await tick();await tick();ok(sends.length===s0,'paused campaign sends nothing');
await f(`/api/campaigns/${k.id}/resume`,'POST',{},A);await f(`/api/campaigns/${k.id}/cancel`,'POST',{},A);await tick();ok(sends.length===s0,'cancelled campaign sends nothing');
const csv=await real(B+`/api/campaigns/${k.id}/export.csv`,{headers:{authorization:'Bearer '+A}});ok(csv.status===200&&(await csv.text()).startsWith('phone,status'),'csv export');
// import
const fd=new FormData();fd.append('file',new Blob(['phone,name\n9111111111,A\n9111111111,Dup\nabc,Bad\n9000000004,Existing\n']),'c.csv');fd.append('mapping',JSON.stringify({phone:'phone',name:'name'}));
const im=await real(B+'/api/contacts/import',{method:'POST',headers:{authorization:'Bearer '+A},body:fd}).then(r=>r.json());
ok(im.imported===1&&im.invalid===1&&im.duplicates===2,'import: '+JSON.stringify({i:im.imported,inv:im.invalid,d:im.duplicates}));
ok((await L.q("SELECT consent_status FROM contacts WHERE phone='919000000004'")).rows[0].consent_status==='opted_in','reimport leaves consent untouched');
console.log(fails?`\n${fails} FAILED`:'\nALL PASSED');await L.pool.end();await pg.stop();process.exit(fails?1:0);
