import EP from 'embedded-postgres';import fs from 'fs';
const pg=new EP({databaseDir:'/tmp/thudhuvan-test-pg2',user:'t',password:'t',port:54349,persistent:false,createPostgresUser:true});
await pg.initialise();await pg.start();await pg.createDatabase('t');
Object.assign(process.env,{DATABASE_URL:'postgres://t:t@localhost:54349/t',APP_URL:'http://app.test',JWT_SECRET:'x',ENCRYPTION_KEY:'a'.repeat(64),DEFAULT_COUNTRY:'IN',WORKER_ENABLED:'false',NODE_ENV:'test'});
const H='./';const L=await import(H+'src/lib.js');await L.pool.query(fs.readFileSync(H+'schema.sql','utf8'));
const real=globalThis.fetch;globalThis.fetch=async(u,o)=>String(u).includes('graph.facebook.com')?{ok:true,status:200,json:async()=>({display_phone_number:'+91 9',verified_name:'T',code_verification_status:'VERIFIED',messages:[{id:'w'}]})}:real(u,o);
const {default:express}=await import(H+'node_modules/express/index.js');const {api}=await import(H+'src/routes.js');
const app=express();app.use(express.json({verify:(r,_,b)=>r.rawBody=b}));app.use('/api',api);app.use((e,_q,res,_n)=>res.status(e.status||500).json({error:e.message}));app.listen(54350);
const B='http://localhost:54350';const f=async(p,m='GET',b,t)=>{const r=await real(B+p,{method:m,headers:{'content-type':'application/json',...(t&&{authorization:'Bearer '+t})},body:b?JSON.stringify(b):undefined});return{s:r.status,j:await r.json().catch(()=>null)}};
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
async function user(e,w){const r=await f('/api/auth/register','POST',{email:e,password:'password1',workspace:w});const t=new URL(r.j.dev_verify_link).searchParams.get('token');await f('/api/auth/verify','POST',{token:t});return {t,tok:(await f('/api/auth/login','POST',{email:e,password:'password1'})).j.token}}
const A=await user('a@x.com','Biz A');const A_=A.tok;
const dbt=(await L.q("SELECT verify_token v FROM users WHERE email='a@x.com'")).rows[0].v;ok(dbt===null,'verify token consumed');
const u2=await user('c@x.com','Biz C');ok((await L.q("SELECT verify_token FROM users WHERE email='c@x.com'")).rows[0].verify_token===null,'ok');
let r=await f('/api/billing','GET',null,A_);ok(r.j.plan.id==='trial'&&r.j.state==='ok'&&r.j.limits.contacts===500&&r.j.plans.length===2,'trial subscription on sign-up');
await L.q("UPDATE plans SET max_contacts=3,max_senders=1,monthly_messages=1,max_members=2 WHERE id='trial'");
for(const p of ['9000000001','9000000002','9000000003'])await f('/api/contacts','POST',{phone:p},A_);
r=await f('/api/contacts','POST',{phone:'9000000004'},A_);ok(r.s===402&&/Upgrade/.test(r.j.error),'contact limit enforced: '+r.j.error);
const fd=new FormData();fd.append('file',new Blob(['phone\n9111111111\n9222222222\n']),'c.csv');fd.append('mapping',JSON.stringify({phone:'phone'}));
r=await real(B+'/api/contacts/import',{method:'POST',headers:{authorization:'Bearer '+A_},body:fd});ok(r.status===402,'import over limit rejected');
fd.set('dry_run','true');r=await real(B+'/api/contacts/import',{method:'POST',headers:{authorization:'Bearer '+A_},body:fd}).then(x=>x.json());ok(r.room===0&&r.valid===2,'dry run reports room=0');
r=await f('/api/whatsapp/connect','POST',{waba_id:'w',phone_number_id:'p1',access_token:'x'.repeat(30)},A_);ok(r.s===201,'first sender ok');
r=await f('/api/whatsapp/connect','POST',{waba_id:'w',phone_number_id:'p2',access_token:'x'.repeat(30)},A_);ok(r.s===402,'sender limit enforced');
r=await f('/api/whatsapp/connect','POST',{waba_id:'w',phone_number_id:'p1',access_token:'y'.repeat(30)},A_);ok(r.s===201,'reconnecting same number allowed at limit');
// campaigns quota
const acc=(await f('/api/whatsapp/accounts','GET',null,A_)).j[0].id;await L.q("UPDATE wa_accounts SET status='active'");
const cs=(await f('/api/contacts','GET',null,A_)).j;for(const c of cs)await f(`/api/contacts/${c.id}/consent`,'POST',{source:'form'},A_);
await L.q("INSERT INTO conversations(workspace_id,wa_account_id,contact_id,last_inbound_at) SELECT workspace_id,$1,id,now() FROM contacts",[acc]);
const g=(await f('/api/groups','POST',{name:'g'},A_)).j.id;await f(`/api/groups/${g}/members`,'POST',{contact_ids:cs.map(c=>c.id)},A_);
const k=(await f('/api/campaigns','POST',{name:'Camp',wa_account_id:acc,type:'text',body:'hi',group_ids:[g]},A_)).j;
const pv=(await f(`/api/campaigns/${k.id}/preview`,'POST',null,A_)).j;ok(pv.quota.limit===1&&pv.quota.after===3,'preview shows quota usage');
r=await f(`/api/campaigns/${k.id}/launch`,'POST',{confirm:true},A_);ok(r.s===402&&/needs 3 messages/.test(r.j.error),'campaign over monthly quota blocked: '+r.j.error);
await L.q("UPDATE plans SET monthly_messages=5 WHERE id='trial'");r=await f(`/api/campaigns/${k.id}/launch`,'POST',{confirm:true},A_);ok(r.s===200,'campaign within quota launches');
r=await f('/api/billing','GET',null,A_);ok(r.j.usage.messages===3,'queued messages count toward usage');
await L.q("UPDATE campaign_recipients SET status='failed'");r=await f('/api/billing','GET',null,A_);ok(r.j.usage.messages===0,'failed sends do not consume quota');
// expiry
const k2=(await f('/api/campaigns','POST',{name:'Camp2',wa_account_id:acc,type:'text',body:'hi',group_ids:[g]},A_)).j;
await L.q("UPDATE subscriptions SET period_end=now()-interval '1 day'");r=await f(`/api/campaigns/${k2.id}/launch`,'POST',{confirm:true},A_);ok(r.s===402&&/trial has ended/.test(r.j.error),'expired trial blocks sending');
await L.q("UPDATE plans SET max_contacts=2 WHERE id='starter'");r=await f('/api/billing/change-plan','POST',{plan_id:'starter'},A_);ok(r.s===409&&/above this plan/.test(r.j.error),'plan change refused when usage exceeds target limits');
await L.q("UPDATE plans SET max_contacts=5000,max_members=3,max_senders=1,monthly_messages=2000 WHERE id='starter'");
r=await f('/api/billing/change-plan','POST',{plan_id:'starter'},A_);ok(r.s===200&&r.j.plan.id==='starter'&&r.j.canSend,'change plan (non-production) restores sending');
r=await f('/api/billing/change-plan','POST',{plan_id:'trial'},A_);ok(r.s===400,'cannot switch back to trial');
// team
r=await f('/api/team/invite','POST',{email:'c@x.com'},A_);ok(r.s===201,'invite');const link=new URL(r.j.dev_invite_link).searchParams.get('token');
r=await f('/api/team','GET',null,A_);ok(r.j.invites.length===1&&r.j.members.length===1,'pending invite listed');
await L.q("UPDATE plans SET max_members=2 WHERE id='starter'");r=await f('/api/team/invite','POST',{email:'d@x.com'},A_);ok(r.s===402,'team size limit counts pending invites');
const wrong=await user('d@x.com','Biz D');r=await f('/api/team/accept','POST',{token:link},wrong.tok);ok(r.s===403,'invite cannot be used by a different email');
r=await f('/api/team/accept','POST',{token:link},u2.tok);ok(r.s===200,'invitee accepts');
const login=(await f('/api/auth/login','POST',{email:'c@x.com',password:'password1'})).j;ok(login.workspaces.length===2,'invitee now has 2 workspaces');
const wsA=login.workspaces.find(w=>w.name==='Biz A').id;
const asMember=(p,m='GET',b)=>real(B+p,{method:m,headers:{'content-type':'application/json',authorization:'Bearer '+login.token,'x-workspace-id':wsA},body:b&&JSON.stringify(b)}).then(x=>x.status);
ok(await asMember('/api/contacts')===200,'member can use the workspace');ok(await asMember('/api/team/invite','POST',{email:'e@x.com'})===403,'member cannot invite');ok(await asMember('/api/billing/change-plan','POST',{plan_id:'growth'})===403,'member cannot change plan');ok(await asMember('/api/audit')===403,'member cannot read audit');
ok((await f('/api/contacts','GET',null,wrong.tok)).j.every(c=>true)&&(await real(B+'/api/contacts',{headers:{authorization:'Bearer '+wrong.tok,'x-workspace-id':wsA}})).status===403,'non-member cannot use someone else\'s workspace');
r=await f('/api/team','GET',null,A_);const cid=r.j.members.find(m=>m.email==='c@x.com').id;ok((await f('/api/team/members/'+cid,'DELETE',null,A_)).s===204,'owner removes member');
ok((await f('/api/team/members/'+r.j.me,'DELETE',null,A_)).s===400,'owner cannot remove self');
// admin
r=await f('/api/admin/workspaces','GET',null,A_);ok(r.s===403,'admin endpoints closed to normal users');
await L.q("UPDATE users SET is_platform_admin=true WHERE email='a@x.com'");const ws=(await L.q("SELECT workspace_id w FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE u.email='d@x.com'")).rows[0].w;
r=await f(`/api/admin/workspaces/${ws}/subscription`,'PUT',{plan_id:'growth',days:30},A_);ok(r.s===200,'admin activates plan manually');ok((await L.q('SELECT plan_id,status FROM subscriptions WHERE workspace_id=$1',[ws])).rows[0].plan_id==='growth','plan changed');
// lockout
for(let i=0;i<5;i++)await f('/api/auth/login','POST',{email:'d@x.com',password:'wrong'});
r=await f('/api/auth/login','POST',{email:'d@x.com',password:'password1'});ok(r.s===429,'account locked after 5 failed logins');
console.log(fails?`\n${fails} FAILED`:'\nALL PASSED');await L.pool.end();await pg.stop();process.exit(fails?1:0)
