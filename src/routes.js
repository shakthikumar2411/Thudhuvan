import {Router} from 'express';import bcrypt from 'bcryptjs';import crypto from 'crypto';import multer from 'multer';import {parse} from 'csv-parse/sync';import ExcelJS from 'exceljs';import {z} from 'zod';
import {q,pool,env,auth,ownerOnly,sign,audit,wrap,encrypt,normPhone,setSession,clearSession} from './lib.js';import {mailVerify,mailReset} from './mail.js';import {fetchPhone,listTemplates,tokenOf} from './whatsapp.js';import {limit,room} from './billing.js';
const h=t=>crypto.createHash('sha256').update(String(t)).digest('hex'); // tokens are stored hashed
export const api=Router();
const up=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024}});
const parseBody=(s,b)=>{const r=s.safeParse(b);if(!r.success)throw Object.assign(new Error(r.error.issues[0].message),{status:400});return r.data};
/* ---- Auth ---- */
api.post('/auth/register',wrap(async(req,res)=>{
 const d=parseBody(z.object({email:z.string().email(),password:z.string().min(8),workspace:z.string().min(2)}),req.body);
 const tok=crypto.randomBytes(24).toString('hex'),c=await pool.connect();
 try{await c.query('BEGIN');
  const u=await c.query('INSERT INTO users(email,password_hash,verify_token) VALUES(lower($1),$2,$3) RETURNING id',[d.email,await bcrypt.hash(d.password,12),h(tok)]).catch(e=>{throw e.code==='23505'?Object.assign(new Error('This email is already registered.'),{status:409}):e});
  const w=await c.query('INSERT INTO workspaces(name) VALUES($1) RETURNING id',[d.workspace]);
  await c.query("INSERT INTO workspace_members VALUES($1,$2,'owner')",[w.rows[0].id,u.rows[0].id]);await c.query("INSERT INTO subscriptions(workspace_id,plan_id) VALUES($1,'trial')",[w.rows[0].id]);await c.query('COMMIT')}
 catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 const link=`${env.APP_URL}/verify?token=${tok}`;await mailVerify(d.email,tok);
 res.status(201).json({message:'Check your email to verify your account.',...(env.NODE_ENV!=='production'&&{dev_verify_link:link})})}));
api.post('/auth/verify',wrap(async(req,res)=>{const r=await q('UPDATE users SET email_verified_at=now(),verify_token=NULL WHERE verify_token=$1 RETURNING id',[h(req.body.token)]);
 r.rowCount?res.json({ok:true}):res.status(400).json({error:'This verification link is invalid or already used.'})}));
api.post('/auth/login',wrap(async(req,res)=>{const {email,password}=req.body;
 const {rows:[u]}=await q('SELECT * FROM users WHERE email=lower($1)',[email||'']);
 if(u?.locked_until&&new Date(u.locked_until)>new Date())return res.status(429).json({error:'Too many failed attempts. Try again in a few minutes or reset your password.'});
 if(!u||!await bcrypt.compare(password||'',u.password_hash)){if(u)await q("UPDATE users SET failed_logins=failed_logins+1,locked_until=CASE WHEN failed_logins+1>=5 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$1",[u.id]);return res.status(401).json({error:'Email or password is incorrect.'})}
 await q('UPDATE users SET failed_logins=0,locked_until=NULL WHERE id=$1',[u.id]);
 if(!u.email_verified_at)return res.status(403).json({error:'Verify your email before signing in.'});
 if(u.status!=='active')return res.status(403).json({error:'This account is '+u.status+'.'});
 const {rows:ws}=await q('SELECT w.id,w.name,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1',[u.id]);
 const token=sign({uid:u.id,ws:ws[0]?.id});setSession(res,token);res.json({token,workspaces:ws})}));
api.post('/auth/forgot',wrap(async(req,res)=>{const t=crypto.randomBytes(24).toString('hex');
 const r=await q("UPDATE users SET reset_token=$2,reset_expires=now()+interval '1 hour' WHERE email=lower($1) RETURNING email",[req.body.email||'',h(t)]);
 if(r.rowCount)await mailReset(r.rows[0].email,t);res.json({message:'If that email exists, a reset link has been sent.'})}));
api.post('/auth/resend-verification',wrap(async(req,res)=>{const {rows:[u]}=await q('SELECT id,email FROM users WHERE email=lower($1) AND email_verified_at IS NULL',[req.body.email||'']);
 if(u){const t=crypto.randomBytes(24).toString('hex');await q('UPDATE users SET verify_token=$2 WHERE id=$1',[u.id,h(t)]);await mailVerify(u.email,t)}
 res.json({message:'If that account still needs verification, a new email is on its way.'})}));
api.post('/auth/logout',(_req,res)=>{clearSession(res);res.json({ok:true})});
api.post('/auth/reset',wrap(async(req,res)=>{const {token,password}=req.body;if(!password||password.length<8)return res.status(400).json({error:'Use at least 8 characters.'});
 const r=await q('UPDATE users SET password_hash=$2,reset_token=NULL,failed_logins=0,locked_until=NULL WHERE reset_token=$1 AND reset_expires>now() RETURNING id',[h(token),await bcrypt.hash(password,12)]);
 r.rowCount?res.json({ok:true}):res.status(400).json({error:'This reset link is invalid or expired.'})}));
/* ---- Everything below is tenant-scoped via req.ws ---- */
api.use(auth);
api.get('/me',(req,res)=>res.json({user:req.user,workspace:req.ws,role:req.role}));
/* WhatsApp account connection (FR-009..016) */
api.post('/whatsapp/connect',ownerOnly,wrap(async(req,res)=>{
 const d=parseBody(z.object({waba_id:z.string(),phone_number_id:z.string(),access_token:z.string().min(20)}),req.body);
 const had=await q('SELECT 1 FROM wa_accounts WHERE phone_number_id=$1 AND workspace_id=$2',[d.phone_number_id,req.ws]);if(!had.rowCount)await limit(req.ws,'senders',1);
 let info;try{info=await fetchPhone(d.phone_number_id,d.access_token)}catch(e){return res.status(400).json({error:'Meta rejected these details: '+e.message})}
 const st=info.code_verification_status==='VERIFIED'?'active':'pending';
 const {rows:[a]}=await q(`INSERT INTO wa_accounts(workspace_id,waba_id,phone_number_id,display_number,verified_name,status,token_enc,quality) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
  ON CONFLICT(phone_number_id) DO UPDATE SET token_enc=EXCLUDED.token_enc,status=EXCLUDED.status,quality=EXCLUDED.quality WHERE wa_accounts.workspace_id=$1 RETURNING id,display_number,verified_name,status`,
  [req.ws,d.waba_id,d.phone_number_id,info.display_phone_number,info.verified_name,st,encrypt(d.access_token),info.quality_rating]);
 if(!a)return res.status(409).json({error:'This phone number is connected to another workspace.'});
 await audit(req.ws,req.user.id,'whatsapp.connect',{phone:info.display_phone_number});res.status(201).json(a)}));
api.get('/whatsapp/accounts',wrap(async(req,res)=>res.json((await q('SELECT id,display_number,verified_name,status,quality,waba_id FROM wa_accounts WHERE workspace_id=$1',[req.ws])).rows))); // token never returned
api.post('/whatsapp/accounts/:id/sync-templates',ownerOnly,wrap(async(req,res)=>{
 const {rows:[a]}=await q('SELECT * FROM wa_accounts WHERE id=$1 AND workspace_id=$2',[req.params.id,req.ws]);if(!a)return res.sendStatus(404);
 const t=await listTemplates(a.waba_id,tokenOf(a));
 for(const x of t.data||[])await q(`INSERT INTO templates(workspace_id,wa_account_id,name,language,status,category,components) VALUES($1,$2,$3,$4,$5,$6,$7)
  ON CONFLICT(workspace_id,name,language) DO UPDATE SET status=EXCLUDED.status,components=EXCLUDED.components`,[req.ws,a.id,x.name,x.language,x.status,x.category,JSON.stringify(x.components)]);
 res.json({synced:(t.data||[]).length})}));
api.get('/templates',wrap(async(req,res)=>res.json((await q('SELECT id,name,language,status,category,components FROM templates WHERE workspace_id=$1 ORDER BY name',[req.ws])).rows)));
/* Contacts (FR-017..022) */
api.get('/contacts',wrap(async(req,res)=>{const s=`%${req.query.q||''}%`,lim=Math.min(+req.query.limit||50,200),off=+req.query.offset||0;
 const r=await q(`SELECT c.*,EXISTS(SELECT 1 FROM suppressions s WHERE s.workspace_id=c.workspace_id AND s.phone=c.phone) AS opted_out FROM contacts c WHERE c.workspace_id=$1 AND (c.phone ILIKE $2 OR c.name ILIKE $2 OR c.email ILIKE $2) ORDER BY c.created_at DESC LIMIT $3 OFFSET $4`,[req.ws,s,lim,off]);res.json(r.rows)}));
api.post('/contacts',wrap(async(req,res)=>{const d=parseBody(z.object({phone:z.string(),name:z.string().optional(),email:z.string().email().optional().or(z.literal(''))}),req.body);
 const p=normPhone(d.phone);if(!p)return res.status(400).json({error:'This phone number is invalid. Include the country code.'});
 await limit(req.ws,'contacts',1);
 const r=await q('INSERT INTO contacts(workspace_id,phone,name,email) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *',[req.ws,p,d.name||null,d.email||null]);
 r.rowCount?res.status(201).json(r.rows[0]):res.status(409).json({error:'A contact with this number already exists.'})}));
api.patch('/contacts/:id',wrap(async(req,res)=>{const {name,email}=req.body;
 const r=await q('UPDATE contacts SET name=COALESCE($3,name),email=COALESCE($4,email) WHERE id=$1 AND workspace_id=$2 RETURNING *',[req.params.id,req.ws,name,email]);r.rowCount?res.json(r.rows[0]):res.sendStatus(404)}));
api.delete('/contacts/:id',wrap(async(req,res)=>{const r=await q('DELETE FROM contacts WHERE id=$1 AND workspace_id=$2',[req.params.id,req.ws]);await audit(req.ws,req.user.id,'contact.delete',{id:req.params.id});res.sendStatus(r.rowCount?204:404)})); // suppressions are kept deliberately
/* Consent & opt-out (FR-037..042) */
api.post('/contacts/:id/consent',wrap(async(req,res)=>{const {source,evidence}=parseBody(z.object({source:z.string().min(2),evidence:z.string().optional()}),req.body);
 const {rows:[c]}=await q('SELECT id,phone FROM contacts WHERE id=$1 AND workspace_id=$2',[req.params.id,req.ws]);if(!c)return res.sendStatus(404);
 const sup=await q('SELECT 1 FROM suppressions WHERE workspace_id=$1 AND phone=$2',[req.ws,c.phone]);
 if(sup.rowCount&&!req.body.override_optout)return res.status(409).json({error:'This contact opted out. Record new consent with override_optout=true only if they opted in again.'});
 if(sup.rowCount)await q('DELETE FROM suppressions WHERE workspace_id=$1 AND phone=$2',[req.ws,c.phone]);
 await q("UPDATE contacts SET consent_status='opted_in' WHERE id=$1",[c.id]);
 await q("INSERT INTO consent_records(workspace_id,contact_id,action,source,evidence,created_by) VALUES($1,$2,'opt_in',$3,$4,$5)",[req.ws,c.id,source,evidence,req.user.id]);res.json({ok:true})}));
api.post('/contacts/:id/opt-out',wrap(async(req,res)=>{const {rows:[c]}=await q('SELECT id,phone FROM contacts WHERE id=$1 AND workspace_id=$2',[req.params.id,req.ws]);if(!c)return res.sendStatus(404);
 await q('INSERT INTO suppressions(workspace_id,phone,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[req.ws,c.phone,'manual']);await q("UPDATE contacts SET consent_status='none' WHERE id=$1",[c.id]);
 await q("INSERT INTO consent_records(workspace_id,contact_id,action,source,created_by) VALUES($1,$2,'opt_out','manual',$3)",[req.ws,c.id,req.user.id]);res.json({ok:true})}));
/* Bulk import (FR-028..036): CSV/XLSX, column mapping, partial import, never touches consent */
async function readRows(f){const n=f.originalname.toLowerCase();
 if(n.endsWith('.csv'))return parse(f.buffer,{columns:true,skip_empty_lines:true,trim:true,bom:true});
 if(n.endsWith('.xlsx')){const wb=new ExcelJS.Workbook();await wb.xlsx.load(f.buffer);const ws=wb.worksheets[0],h=ws.getRow(1).values.slice(1).map(x=>String(x??'').trim()),out=[];
  ws.eachRow((r,i)=>{if(i>1){const o={};h.forEach((k,j)=>{const v=r.getCell(j+1).value;o[k]=v&&typeof v==='object'?(v.text??v.result??''):v??''});out.push(o)}});return out}
 throw Object.assign(new Error('Upload a .csv or .xlsx file.'),{status:400})}
api.post('/contacts/import',up.single('file'),wrap(async(req,res)=>{
 if(!req.file)return res.status(400).json({error:'Choose a file to import.'});
 const map=JSON.parse(req.body.mapping||'{}'),dry=req.body.dry_run==='true',rows=await readRows(req.file);
 if(rows.length>20000)return res.status(400).json({error:'Imports are limited to 20,000 rows.'});
 const cols=Object.keys(rows[0]||{});if(!map.phone)return res.json({columns:cols,sample:rows.slice(0,5),needs_mapping:true});
 const seen=new Set(),good=[],errors=[];let dup=0;
 rows.forEach((r,i)=>{const p=normPhone(r[map.phone]);if(!p)return errors.push({row:i+2,reason:'Invalid phone number'});
  if(seen.has(p)){dup++;return errors.push({row:i+2,reason:'Duplicate in file: '+p})}seen.add(p);good.push([p,r[map.name]||null,r[map.email]||null])});
 const rm=await room(req.ws,'contacts');if(good.length>rm&&!dry)return res.status(402).json({error:`Your plan has room for ${rm} more contacts but this file has ${good.length} valid rows. Upgrade your plan or import a smaller file.`});
 let imported=0;
 if(!dry&&good.length){const c=await pool.connect();try{await c.query('BEGIN');
  for(const [p,n,e] of good){const r=await c.query('INSERT INTO contacts(workspace_id,phone,name,email) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[req.ws,p,n,e]);if(r.rowCount)imported++;else{dup++;errors.push({row:null,reason:'Already exists: '+p})}} // existing rows (and their consent) untouched
  await c.query('INSERT INTO import_jobs(workspace_id,filename,total,imported,duplicates,invalid,errors,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[req.ws,req.file.originalname,rows.length,imported,dup,rows.length-good.length-0,JSON.stringify(errors.slice(0,500)),req.user.id]);await c.query('COMMIT')}
  catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
 res.json({room:rm,dry_run:dry,total:rows.length,valid:good.length,imported,duplicates:dup,invalid:errors.filter(e=>e.reason.startsWith('Invalid')).length,errors:errors.slice(0,200)})}));
/* Groups */
api.get('/groups',wrap(async(req,res)=>res.json((await q('SELECT g.*,(SELECT count(*) FROM group_members m WHERE m.group_id=g.id)::int AS size FROM groups g WHERE workspace_id=$1 ORDER BY name',[req.ws])).rows)));
api.post('/groups',wrap(async(req,res)=>{const n=(req.body.name||'').trim();if(!n)return res.status(400).json({error:'Enter a group name.'});
 const r=await q('INSERT INTO groups(workspace_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING *',[req.ws,n]);r.rowCount?res.status(201).json(r.rows[0]):res.status(409).json({error:'A group with this name exists.'})}));
api.post('/groups/:id/members',wrap(async(req,res)=>{const ids=req.body.contact_ids||[];
 const r=await q(`INSERT INTO group_members SELECT $1,c.id FROM contacts c WHERE c.workspace_id=$2 AND c.id=ANY($3::uuid[]) AND EXISTS(SELECT 1 FROM groups WHERE id=$1 AND workspace_id=$2) ON CONFLICT DO NOTHING`,[req.params.id,req.ws,ids]);res.json({added:r.rowCount})}));
import {campaignsApi} from './campaigns.js';import {inboxApi} from './inbox.js';
api.use(campaignsApi);api.use(inboxApi);
import {miscApi} from './misc.js';
api.use(miscApi);
import {billingApi} from './billing.js';import {teamApi} from './team.js';
api.use(billingApi);api.use(teamApi);
