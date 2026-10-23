import pg from 'pg';import crypto from 'crypto';import jwt from 'jsonwebtoken';import {parsePhoneNumberFromString} from 'libphonenumber-js';
export const env=process.env;
export const pool=new pg.Pool({connectionString:env.DATABASE_URL});
pool.on('error',e=>console.error('pg idle client error',e.message)); // a dropped idle connection must not crash the API
export const q=(t,p)=>pool.query(t,p);
const key=()=>Buffer.from(env.ENCRYPTION_KEY||'','hex');
export function encrypt(s){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv),e=Buffer.concat([c.update(s,'utf8'),c.final()]);return [iv,c.getAuthTag(),e].map(b=>b.toString('base64')).join('.')}
export function decrypt(s){const [iv,t,e]=s.split('.').map(x=>Buffer.from(x,'base64')),d=crypto.createDecipheriv('aes-256-gcm',key(),iv);d.setAuthTag(t);return Buffer.concat([d.update(e),d.final()]).toString('utf8')}
export const normPhone=(raw,cc=env.DEFAULT_COUNTRY||'IN')=>{const p=parsePhoneNumberFromString(String(raw||'').trim(),cc);return p&&p.isValid()?p.number.replace('+',''):null}; // E.164 digits, as Meta expects
export const sign=u=>jwt.sign(u,env.JWT_SECRET,{expiresIn:'7d'});
export const audit=(ws,user,action,detail={})=>q('INSERT INTO audit_logs(workspace_id,user_id,action,detail) VALUES($1,$2,$3,$4)',[ws,user,action,detail]).catch(()=>{});
export const wrap=f=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
/* Auth + tenant context. Every workspace query MUST use req.ws. */
export const auth=wrap(async(req,res,next)=>{
 try{const bearer=(req.headers.authorization||'').replace('Bearer ',''),ck=parseCookies(req.headers.cookie),t=bearer||ck.thd_session;
  if(!bearer&&!['GET','HEAD','OPTIONS'].includes(req.method)){ // cookie sessions need a CSRF token on every state-changing request
   const hd=String(req.headers['x-csrf-token']||''),cs=ck.thd_csrf||'';
   if(!cs||hd.length!==cs.length||!crypto.timingSafeEqual(Buffer.from(hd),Buffer.from(cs)))return res.status(403).json({error:'Security check failed. Refresh the page and try again.'})}
  const p=jwt.verify(t,env.JWT_SECRET,{algorithms:['HS256']});
  const {rows:[u]}=await q('SELECT id,status,is_platform_admin FROM users WHERE id=$1',[p.uid]);
  if(!u||u.status!=='active')return res.status(403).json({error:'Account is not active.'});
  const wsId=req.headers['x-workspace-id']||p.ws;
  const {rows:[m]}=await q('SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',[wsId,u.id]);
  if(!m)return res.status(403).json({error:'You do not have access to this workspace.'});
  Object.assign(req,{user:u,ws:wsId,role:m.role});next()}
 catch(e){res.status(401).json({error:'Sign in required.'})}});
export const ownerOnly=(req,res,next)=>req.role==='owner'?next():res.status(403).json({error:'Owner permission required.'});
const parseCookies=h=>Object.fromEntries((h||'').split(';').map(c=>c.trim()).filter(Boolean).map(c=>{const i=c.indexOf('=');return[c.slice(0,i),decodeURIComponent(c.slice(i+1))]}));
export function setSession(res,token){const base={sameSite:'lax',secure:env.NODE_ENV==='production',path:'/',maxAge:7*864e5};
 res.cookie('thd_session',token,{...base,httpOnly:true});res.cookie('thd_csrf',crypto.randomBytes(24).toString('hex'),{...base,httpOnly:false})}
export const clearSession=res=>{res.clearCookie('thd_session',{path:'/'});res.clearCookie('thd_csrf',{path:'/'})};
