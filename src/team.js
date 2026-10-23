import {Router} from 'express';import crypto from 'crypto';import {z} from 'zod';import {q,wrap,env,audit,ownerOnly} from './lib.js';import {limit} from './billing.js';import {mailInvite} from './mail.js';import bcrypt from 'bcryptjs';import {pool} from './lib.js';
export const teamApi=Router();const bad=(m,s=400)=>Object.assign(new Error(m),{status:s});
const h=t=>crypto.createHash('sha256').update(String(t)).digest('hex');
teamApi.get('/workspaces',wrap(async(req,res)=>res.json((await q('SELECT w.id,w.name,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at',[req.user.id])).rows)));
teamApi.get('/team',wrap(async(req,res)=>res.json({
 members:(await q('SELECT u.id,u.email,m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.email',[req.ws])).rows,me:req.user.id,
 invites:(req.role==='owner'?(await q('SELECT id,email,role,expires_at FROM invites WHERE workspace_id=$1 AND accepted_at IS NULL AND expires_at>now()',[req.ws])).rows:[])})));
teamApi.post('/team/invite',ownerOnly,wrap(async(req,res)=>{
 const {email}=z.object({email:z.string().email()}).parse(req.body);
 const dup=await q('SELECT 1 FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND u.email=lower($2)',[req.ws,email]);if(dup.rowCount)throw bad('This person is already on your team.',409);
 await limit(req.ws,'members',1);
 const t=crypto.randomBytes(24).toString('hex');
 await q("INSERT INTO invites(token_hash,workspace_id,email,invited_by,expires_at) VALUES($1,$2,lower($3),$4,now()+interval '7 days')",[h(t),req.ws,email,req.user.id]);
 const link=`${env.APP_URL}/accept-invite?token=${t}`;const wsn=(await q('SELECT name FROM workspaces WHERE id=$1',[req.ws])).rows[0].name,by=(await q('SELECT email FROM users WHERE id=$1',[req.user.id])).rows[0].email;await mailInvite(email,wsn,by,t);await audit(req.ws,req.user.id,'team.invite',{email});
 res.status(201).json({ok:true,...(env.NODE_ENV!=='production'&&{dev_invite_link:link})})}));
teamApi.delete('/team/invites/:id',ownerOnly,wrap(async(req,res)=>{await q('DELETE FROM invites WHERE id=$1 AND workspace_id=$2',[req.params.id,req.ws]);res.sendStatus(204)}));
teamApi.delete('/team/members/:uid',ownerOnly,wrap(async(req,res)=>{if(req.params.uid===req.user.id)throw bad('You cannot remove yourself.');
 const r=await q("DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role<>'owner'",[req.ws,req.params.uid]);if(!r.rowCount)throw bad('Member not found, or is an owner.',404);
 await audit(req.ws,req.user.id,'team.remove',{user:req.params.uid});res.sendStatus(204)}));
teamApi.post('/team/accept',wrap(async(req,res)=>{
 const {rows:[i]}=await q('SELECT i.*,w.name FROM invites i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.expires_at>now()',[h(req.body.token)]);
 if(!i)throw bad('This invitation is invalid or has expired.',404);
 const {rows:[u]}=await q('SELECT email FROM users WHERE id=$1',[req.user.id]);
 if(u.email.toLowerCase()!==i.email.toLowerCase())throw bad(`This invitation was sent to ${i.email}. Sign in with that email to accept it.`,403);
 await q('INSERT INTO workspace_members VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[i.workspace_id,req.user.id,i.role]);await q('UPDATE invites SET accepted_at=now() WHERE id=$1',[i.id]);
 await audit(i.workspace_id,req.user.id,'team.accept',{});res.json({workspace:{id:i.workspace_id,name:i.name,role:i.role}})}));
/* Permanent workspace deletion (owner, typed name + password) */
teamApi.delete('/workspace',ownerOnly,wrap(async(req,res)=>{const {confirm_name,password}=req.body||{};
 const {rows:[w]}=await q('SELECT name FROM workspaces WHERE id=$1',[req.ws]);if(confirm_name!==w.name)throw bad('Type the workspace name exactly to confirm.');
 const {rows:[u]}=await q('SELECT password_hash FROM users WHERE id=$1',[req.user.id]);if(!await bcrypt.compare(String(password||''),u.password_hash))throw bad('Password is incorrect.',403);
 const c=await pool.connect();try{await c.query('BEGIN');
  for(const t of ['campaign_recipients','messages','conversations','campaigns','templates','consent_records','suppressions','import_jobs','audit_logs'])await c.query(`DELETE FROM ${t} WHERE workspace_id=$1`,[req.ws]);
  await c.query('DELETE FROM workspaces WHERE id=$1',[req.ws]); // cascades contacts, groups, senders, invites, subscription, memberships
  await c.query('DELETE FROM users x WHERE NOT EXISTS(SELECT 1 FROM workspace_members m WHERE m.user_id=x.id) AND NOT x.is_platform_admin');await c.query('COMMIT')}
 catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 console.log('workspace deleted',req.ws);res.sendStatus(204)}));
