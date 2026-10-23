import {Router} from 'express';import {z} from 'zod';import {q,wrap,env,audit,ownerOnly} from './lib.js';
export const billingApi=Router();const bad=(m,s=400)=>Object.assign(new Error(m),{status:s});
/* Single source of truth for what a workspace may do right now */
export async function entitlement(ws){
 const {rows:[r]}=await q('SELECT s.*,p.name plan_name,p.price_inr,p.monthly_messages,p.max_contacts,p.max_members,p.max_senders FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.workspace_id=$1',[ws]);
 if(!r)throw bad('No subscription found for this workspace.',402);
 const u=(await q(`SELECT (SELECT count(*) FROM contacts WHERE workspace_id=$1)::int contacts,
  ((SELECT count(*) FROM workspace_members WHERE workspace_id=$1)+(SELECT count(*) FROM invites WHERE workspace_id=$1 AND accepted_at IS NULL AND expires_at>now()))::int members,
  (SELECT count(*) FROM wa_accounts WHERE workspace_id=$1)::int senders,
  (SELECT count(*) FROM campaign_recipients cr JOIN campaigns k ON k.id=cr.campaign_id WHERE cr.workspace_id=$1 AND k.created_at>=$2 AND cr.status NOT IN('failed','cancelled'))::int messages`,[ws,r.period_start])).rows[0]; // failed/cancelled sends do not consume quota
 const expired=new Date(r.period_end)<new Date();let state='ok',message=null;
 if(r.status==='cancelled'){state='cancelled';message='This subscription is cancelled. Choose a plan to resume sending.'}
 else if(r.status==='past_due'||(expired&&r.status==='active')){state='past_due';message='Your plan period has ended or payment is overdue. Sending is paused until it is renewed.'}
 else if(expired){state='trial_expired';message='Your free trial has ended. Choose a plan to continue sending.'}
 return {plan:{id:r.plan_id,name:r.plan_name,price_inr:r.price_inr},subscription:{status:r.status,period_start:r.period_start,period_end:r.period_end},usage:u,
  limits:{monthly_messages:r.monthly_messages,contacts:r.max_contacts,members:r.max_members,senders:r.max_senders},state,message,canSend:state==='ok'}}
export async function room(ws,what){const E=await entitlement(ws);return Math.max(0,E.limits[what]-E.usage[what])}
export async function limit(ws,what,adding=1){const E=await entitlement(ws);
 if(adding>E.limits[what]-E.usage[what])throw bad(`Your ${E.plan.name} plan allows ${E.limits[what]} ${what}, and you are using ${E.usage[what]}. Upgrade your plan to add more.`,402)}
billingApi.get('/billing',wrap(async(req,res)=>{const E=await entitlement(req.ws);
 res.json({...E,role:req.role,plans:(await q("SELECT id,name,price_inr,monthly_messages,max_contacts,max_members,max_senders FROM plans WHERE active AND id<>'trial' ORDER BY sort")).rows})}));
billingApi.post('/billing/change-plan',ownerOnly,wrap(async(req,res)=>{
 const {plan_id}=z.object({plan_id:z.string()}).parse(req.body);
 const {rows:[p]}=await q("SELECT * FROM plans WHERE id=$1 AND active AND id<>'trial'",[plan_id]);if(!p)throw bad('Choose a valid plan.');
 const E=await entitlement(req.ws);
 if(E.usage.contacts>p.max_contacts||E.usage.senders>p.max_senders||E.usage.members>p.max_members)throw bad('Your current contacts, team or senders are above this plan\'s limits. Reduce them first.',409);
 // Payment integration point: a Razorpay/Stripe adapter must confirm payment before this runs in production.
 if(env.NODE_ENV==='production')throw bad('Online payment is not enabled yet. Contact support and we will activate your plan.',501);
 await q("UPDATE subscriptions SET plan_id=$2,status='active',period_start=now(),period_end=now()+interval '30 days',updated_at=now() WHERE workspace_id=$1",[req.ws,p.id]);
 await audit(req.ws,req.user.id,'billing.change_plan',{plan:p.id});res.json(await entitlement(req.ws))}));
/* Platform admin: manual activation (offline/invoice billing) */
const adminOnly=(req,_r,next)=>req.user.is_platform_admin?next():next(bad('Platform admin only.',403));
billingApi.get('/admin/workspaces',adminOnly,wrap(async(_req,res)=>res.json((await q(`SELECT w.id,w.name,s.plan_id,s.status,s.period_end,(SELECT count(*) FROM contacts c WHERE c.workspace_id=w.id)::int contacts FROM workspaces w JOIN subscriptions s ON s.workspace_id=w.id ORDER BY w.created_at DESC LIMIT 200`)).rows)));
billingApi.put('/admin/workspaces/:id/subscription',adminOnly,wrap(async(req,res)=>{
 const d=z.object({plan_id:z.string(),status:z.enum(['trialing','active','past_due','cancelled']).default('active'),days:z.number().int().min(1).max(366).default(30)}).parse(req.body);
 const r=await q("UPDATE subscriptions SET plan_id=$2,status=$3,period_start=now(),period_end=now()+($4||' days')::interval,updated_at=now() WHERE workspace_id=$1",[req.params.id,d.plan_id,d.status,String(d.days)]);
 if(!r.rowCount)throw bad('Workspace not found.',404);await audit(req.params.id,req.user.id,'admin.set_subscription',d);res.json({ok:true})}));
