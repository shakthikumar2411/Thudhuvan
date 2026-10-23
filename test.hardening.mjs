import EP from 'embedded-postgres';import fs from 'fs';import {spawnSync} from 'child_process';
const pg=new EP({databaseDir:'/tmp/thudhuvan-test-pg3',user:'t',password:'t',port:54359,persistent:false,createPostgresUser:true});
await pg.initialise();await pg.start();await pg.createDatabase('t');
Object.assign(process.env,{DATABASE_URL:'postgres://t:t@localhost:54359/t',APP_URL:'https://app.test',JWT_SECRET:'x',ENCRYPTION_KEY:'a'.repeat(64),DEFAULT_COUNTRY:'IN',WORKER_ENABLED:'false',NODE_ENV:'test',MAIL_MODE:'capture'});
const H='./';const ROOT=H.startsWith('/')?H:process.cwd()+'/';
const L=await import(H+'src/lib.js');await L.pool.query(fs.readFileSync(H+'schema.sql','utf8'));
const {outbox}=await import(H+'src/mail.js');const {handle,reprocessWebhooks}=await import(H+'src/webhook.js');
const real=globalThis.fetch;
const {default:express}=await import(H+'node_modules/express/index.js');const {api}=await import(H+'src/routes.js');
const app=express();app.use(express.json({verify:(r,_,b)=>r.rawBody=b}));app.use('/api',api);app.use((e,_q,res,_n)=>res.status(e.status||500).json({error:e.message}));app.listen(54360);
const B='http://localhost:54360';const f=async(p,m='GET',b,t)=>{const r=await real(B+p,{method:m,headers:{'content-type':'application/json',...(t&&{authorization:'Bearer '+t})},body:b?JSON.stringify(b):undefined});return{s:r.status,j:await r.json().catch(()=>null)}};
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
// ---- env validation
const run=env=>spawnSync('node',['--input-type=module','-e',"await import('./src/env.js')"],{cwd:ROOT,env:{PATH:process.env.PATH,...env},encoding:'utf8'});
let r=run({NODE_ENV:'production',JWT_SECRET:'short'});ok(r.status===1&&/JWT_SECRET/.test(r.stderr)&&/ENCRYPTION_KEY/.test(r.stderr)&&/SMTP_HOST/.test(r.stderr),'production refuses to boot with unsafe config');
r=run({NODE_ENV:'production',JWT_SECRET:'j'.repeat(40),ENCRYPTION_KEY:'ab'.repeat(32),DATABASE_URL:'postgres://x',APP_URL:'https://x.com',META_APP_SECRET:'s',META_VERIFY_TOKEN:'v',SMTP_HOST:'smtp.x.com'});ok(r.status===0,'production boots with complete config');
ok(run({NODE_ENV:'production',JWT_SECRET:'j'.repeat(40),ENCRYPTION_KEY:'ab'.repeat(32),DATABASE_URL:'p',APP_URL:'http://insecure.com',META_APP_SECRET:'s',META_VERIFY_TOKEN:'v',SMTP_HOST:'h'}).status===1,'production rejects non-https APP_URL');
ok(run({NODE_ENV:'development'}).status===0,'development is not blocked');
// ---- email flows
const reg=await f('/api/auth/register','POST',{email:'a@x.com',password:'password1',workspace:'<b>Alpha</b>'});
ok(reg.s===201&&outbox.at(-1)?.to==='a@x.com'&&/\/verify\?token=/.test(outbox.at(-1).url),'registration sends verification email');
const tok1=new URL(outbox.at(-1).url).searchParams.get('token');
ok((await f('/api/auth/login','POST',{email:'a@x.com',password:'password1'})).s===403,'cannot sign in before verifying');
const n0=outbox.length;await f('/api/auth/resend-verification','POST',{email:'a@x.com'});ok(outbox.length===n0+1,'resend sends a new email');
ok((await f('/api/auth/verify','POST',{token:tok1})).s===400,'old verification link is invalidated by resend');
ok((await f('/api/auth/verify','POST',{token:new URL(outbox.at(-1).url).searchParams.get('token')})).s===200,'new verification link works');
const n1=outbox.length;r=await f('/api/auth/resend-verification','POST',{email:'nobody@x.com'});ok(r.s===200&&outbox.length===n1,'resend for unknown email: same answer, no email');
r=await f('/api/auth/resend-verification','POST',{email:'a@x.com'});ok(outbox.length===n1,'resend for verified account sends nothing');
await f('/api/auth/forgot','POST',{email:'a@x.com'});ok(outbox.at(-1).subject.includes('Reset')&&outbox.at(-1).to==='a@x.com','password reset email sent');
const n2=outbox.length;await f('/api/auth/forgot','POST',{email:'ghost@x.com'});ok(outbox.length===n2,'no reset email for unknown address');
const rt=new URL(outbox.at(-1).url).searchParams.get('token');ok((await f('/api/auth/reset','POST',{token:rt,password:'newpassword1'})).s===200,'reset link works');ok((await f('/api/auth/reset','POST',{token:rt,password:'another123'})).s===400,'reset link is single use');
// ---- cookie session + CSRF
const loginRes=await real(B+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'a@x.com',password:'newpassword1'})});
const sc=loginRes.headers.getSetCookie(),sess=sc.find(c=>c.startsWith('thd_session=')),csrfc=sc.find(c=>c.startsWith('thd_csrf='));
ok(/HttpOnly/i.test(sess)&&/SameSite=Lax/i.test(sess),'session cookie is HttpOnly + SameSite=Lax');ok(!/HttpOnly/i.test(csrfc),'csrf cookie readable by the app');
const val=c=>c.split(';')[0].split('=')[1],csrf=val(csrfc),cookie=`thd_session=${val(sess)}; thd_csrf=${csrf}`;
const viaCookie=(p,m='GET',h={},b)=>real(B+p,{method:m,headers:{cookie,'content-type':'application/json',...h},body:b&&JSON.stringify(b)}).then(x=>x.status);
ok(await viaCookie('/api/me')===200,'cookie session authenticates GET');
ok(await viaCookie('/api/groups','POST',{},{name:'g1'})===403,'POST with cookie and no CSRF header is rejected');
ok(await viaCookie('/api/groups','POST',{'x-csrf-token':'wrong'.padEnd(csrf.length,'x')},{name:'g1'})===403,'wrong CSRF token rejected');
ok(await viaCookie('/api/groups','POST',{'x-csrf-token':csrf},{name:'g1'})===201,'correct CSRF token accepted');
const bearer=(await loginRes.json()).token;ok((await f('/api/groups','POST',{name:'g2'},bearer)).s===201,'Bearer API clients need no CSRF token');
const out=await real(B+'/api/auth/logout',{method:'POST'});ok(out.headers.getSetCookie().some(c=>/thd_session=;/.test(c)),'logout clears the session cookie');
// ---- invite email
const login=async(e,p='password1')=>(await f('/api/auth/login','POST',{email:e,password:p})).j;
r=await f('/api/team/invite','POST',{email:'b@x.com'},bearer);ok(r.s===201&&outbox.at(-1).to==='b@x.com'&&/invited you to <b>Alpha<\/b>/.test(outbox.at(-1).subject)&&/accept-invite/.test(outbox.at(-1).url),'invite email sent');
// ---- webhook replay
const ev={metadata:{phone_number_id:'px9'},contacts:[{profile:{name:'Q'}}],messages:[{from:'919777777777',id:'wamid.rp1',type:'text',text:{body:'hello'}}]};
await L.q("INSERT INTO webhook_events(event_id,payload) VALUES('e1',$1)",[ev]);await handle('e1',ev);
ok((await L.q("SELECT error FROM webhook_events WHERE event_id='e1'")).rows[0].error?.includes('Unknown'),'event for unknown number is recorded as failed');
await L.q("INSERT INTO wa_accounts(workspace_id,waba_id,phone_number_id,token_enc,status) SELECT id,'w','px9','x','active' FROM workspaces LIMIT 1");
ok(await reprocessWebhooks()===0,'fresh failures are not retried immediately');
await L.q("UPDATE webhook_events SET received_at=now()-interval '5 minutes'");
ok(await reprocessWebhooks()===1,'failed event is retried once the number exists');
const ee=(await L.q("SELECT processed_at,error FROM webhook_events WHERE event_id='e1'")).rows[0];ok(ee.processed_at&&!ee.error,'retried event marked processed');
ok((await L.q("SELECT count(*)::int n FROM messages WHERE provider_message_id='wamid.rp1'")).rows[0].n===1,'inbound message stored from retry');
await reprocessWebhooks();await handle('e1',ev);ok((await L.q("SELECT count(*)::int n FROM messages WHERE provider_message_id='wamid.rp1'")).rows[0].n===1,'replay is idempotent (no duplicate message)');
// ---- workspace deletion
await f('/api/auth/register','POST',{email:'x@x.com',password:'password1',workspace:'Del Co'});await f('/api/auth/verify','POST',{token:new URL(outbox.at(-1).url).searchParams.get('token')});
const X=(await login('x@x.com')).token;await f('/api/contacts','POST',{phone:'9000000001'},X);await f('/api/groups','POST',{name:'gx'},X);
ok((await f('/api/workspace','DELETE',{confirm_name:'wrong',password:'password1'},X)).s===400,'delete needs the exact workspace name');
ok((await f('/api/workspace','DELETE',{confirm_name:'Del Co',password:'bad'},X)).s===403,'delete needs the correct password');
ok((await f('/api/workspace','DELETE',{confirm_name:'Del Co',password:'password1'},X)).s===204,'owner deletes workspace');
ok((await L.q("SELECT count(*)::int n FROM workspaces WHERE name='Del Co'")).rows[0].n===0&&(await L.q("SELECT count(*)::int n FROM contacts WHERE phone='919000000001'")).rows[0].n===0,'workspace data is gone');
ok((await L.q("SELECT count(*)::int n FROM users WHERE email='x@x.com'")).rows[0].n===0,'orphaned user removed');
ok((await f('/api/contacts','GET',null,bearer)).s===200,'other workspaces are unaffected');
console.log(fails?`\n${fails} FAILED`:'\nALL PASSED');await L.pool.end();await pg.stop();process.exit(fails?1:0)
