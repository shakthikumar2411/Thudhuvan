import {Router} from 'express';import {q,audit,wrap} from './lib.js';
export const miscApi=Router();
miscApi.get('/dashboard',wrap(async(req,res)=>{const ws=req.ws;
 const [c,s,k,t,u,r]=await Promise.all([
  q(`SELECT count(*)::int total,count(*) FILTER(WHERE consent_status='opted_in' AND NOT EXISTS(SELECT 1 FROM suppressions s WHERE s.workspace_id=c.workspace_id AND s.phone=c.phone))::int eligible,(SELECT count(*)::int FROM suppressions WHERE workspace_id=$1) opted_out FROM contacts c WHERE workspace_id=$1`,[ws]),
  q('SELECT id,display_number,verified_name,status,quality FROM wa_accounts WHERE workspace_id=$1',[ws]),
  q(`SELECT count(*)::int total,count(*) FILTER(WHERE status IN('queued','sending','scheduled','paused'))::int active FROM campaigns WHERE workspace_id=$1`,[ws]),
  q(`SELECT count(*) FILTER(WHERE status='APPROVED')::int approved,count(*)::int total FROM templates WHERE workspace_id=$1`,[ws]),
  q('SELECT coalesce(sum(unread),0)::int n FROM conversations WHERE workspace_id=$1',[ws]),
  q(`SELECT k.id,k.name,k.status,k.created_at,count(r.*)::int total,count(*) FILTER(WHERE r.status IN('delivered','read'))::int delivered FROM campaigns k LEFT JOIN campaign_recipients r ON r.campaign_id=k.id WHERE k.workspace_id=$1 GROUP BY k.id ORDER BY k.created_at DESC LIMIT 5`,[ws])]);
 res.json({contacts:c.rows[0],senders:s.rows,campaigns:k.rows[0],templates:t.rows[0],unread:u.rows[0].n,recent:r.rows})}));
miscApi.get('/groups/:id/members',wrap(async(req,res)=>res.json((await q(`SELECT c.id,c.name,c.phone,c.consent_status FROM group_members m JOIN contacts c ON c.id=m.contact_id JOIN groups g ON g.id=m.group_id WHERE m.group_id=$1 AND g.workspace_id=$2 ORDER BY c.name NULLS LAST LIMIT 1000`,[req.params.id,req.ws])).rows)));
miscApi.delete('/groups/:id/members/:cid',wrap(async(req,res)=>{await q('DELETE FROM group_members m USING groups g WHERE m.group_id=g.id AND g.workspace_id=$1 AND m.group_id=$2 AND m.contact_id=$3',[req.ws,req.params.id,req.params.cid]);res.sendStatus(204)}));
miscApi.delete('/groups/:id',wrap(async(req,res)=>{const r=await q('DELETE FROM groups WHERE id=$1 AND workspace_id=$2',[req.params.id,req.ws]);await audit(req.ws,req.user.id,'group.delete',{id:req.params.id});res.sendStatus(r.rowCount?204:404)}));
miscApi.delete('/campaigns/:id',wrap(async(req,res)=>{const r=await q("DELETE FROM campaigns WHERE id=$1 AND workspace_id=$2 AND status='draft'",[req.params.id,req.ws]);r.rowCount?res.sendStatus(204):res.status(409).json({error:'Only draft campaigns can be deleted.'})}));
