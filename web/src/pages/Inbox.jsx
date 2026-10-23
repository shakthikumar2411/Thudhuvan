import {useState,useEffect,useRef} from 'react';import {api,useFetch} from '../api.js';import {PageHead,Badge,Spinner,Empty,Field,when,ago,phone,useToast} from '../ui.jsx';
const TABS=[['all','All',''],['unread','Unread','?unread=true'],['open','Open','?status=open'],['resolved','Resolved','?status=resolved']];
const bodyOf=t=>(t?.components||[]).find(c=>c.type==='BODY')?.text||'';
export default function Inbox(){const toast=useToast(),[tab,setTab]=useState('all'),[sel,setSel]=useState(null);
 const {data:list,loading,reload:rl}=useFetch('/conversations'+TABS.find(t=>t[0]===tab)[2],{every:8000});
 const {data:th,reload:rt}=useFetch(`/conversations/${sel}/messages`,{every:5000,skip:!sel}),{data:tpls}=useFetch('/templates');
 const [text,setText]=useState(''),[tid,setTid]=useState(''),[pm,setPm]=useState([]),[b,setB]=useState(false),end=useRef();
 const cur=list?.find(c=>c.id===sel),approved=(tpls||[]).filter(t=>t.status==='APPROVED'),tpl=approved.find(t=>t.id===tid),nv=new Set(bodyOf(tpl).match(/\{\{\d+\}\}/g)||[]).size;
 useEffect(()=>{end.current?.scrollIntoView()},[th?.messages?.length,sel]);useEffect(()=>{if(sel)setTimeout(rl,600)},[sel]);
 const send=async body=>{setB(true);try{await api(`/conversations/${sel}/reply`,{method:'POST',body});setText('');setTid('');setPm([]);rt();rl()}catch(x){toast(x.message,'err');rt()}setB(false)};
 const setStatus=async s=>{await api('/conversations/'+sel,{method:'PATCH',body:{status:s}});rl();toast(s==='resolved'?'Conversation resolved':'Conversation reopened')};
 return <><PageHead title="Inbox" sub="Replies from customers. Free-form replies work within 24 hours of their last message."/>
  <div className={'inbox'+(sel?' thr':'')}><div className="clist"><div className="tabs">{TABS.map(([k,l])=><button key={k} className={tab===k?'on':''} onClick={()=>setTab(k)}>{l}</button>)}</div>
   {loading&&!list?<Spinner/>:list?.length?list.map(c=><div key={c.id} className={'citem'+(c.id===sel?' on':'')} tabIndex={0} role="button" onClick={()=>setSel(c.id)} onKeyDown={e=>e.key==='Enter'&&setSel(c.id)}>
    <div className="t"><b>{c.name||phone(c.phone)}</b>{c.unread>0&&<span className="nb" style={{background:'var(--bad)',color:'#fff',borderRadius:10,padding:'0 7px',fontSize:12}}>{c.unread}</span>}</div><p>{c.last_message}</p><small className="muted">{ago(c.last_activity_at)}</small></div>):<Empty title="No conversations" text="Customer replies will show up here."/>}</div>
   <div className="thread">{!sel?<Empty title="Select a conversation" text="Choose one from the list."/>:!th?<Spinner/>:<>
    <div className="thead"><div><button className="btn ghost sm" style={{marginRight:8}} onClick={()=>setSel(null)}>←</button><b>{cur?.name||phone(cur?.phone)}</b> <span className="muted">{phone(cur?.phone)}</span> {cur&&<Badge s={cur.status}/>}</div>
     <button className="btn ghost sm" onClick={()=>setStatus(cur?.status==='resolved'?'open':'resolved')}>{cur?.status==='resolved'?'Reopen':'Mark resolved'}</button></div>
    <div className={'wbar '+(th.window_open?'open':'closed')}>{th.window_open?`Reply window open until ${when(th.window_closes_at)}`:'The 24-hour window has closed. Send an approved template to restart the conversation.'}</div>
    <div className="msgs">{th.messages.map(m=><div key={m.id} className={'m '+(m.direction==='outbound'?'out':'')}>{m.body}<small>{when(m.created_at)}{m.direction==='outbound'&&` · ${m.status}`}{m.error&&` · ${m.error}`}</small></div>)}<div ref={end}/></div>
    <div className="composer">{th.window_open?<div className="row" style={{flexWrap:'nowrap'}}><textarea style={{minHeight:46,height:46}} aria-label="Reply" placeholder="Type a reply" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&text.trim()){e.preventDefault();send({text})}}}/><button className="btn fit" disabled={b||!text.trim()} onClick={()=>send({text})}>Send</button></div>
     :<><Field label="Send a template"><select value={tid} onChange={e=>{setTid(e.target.value);setPm([])}}><option value="">Choose approved template</option>{approved.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      {tpl&&<><div className="pv"><div className="bubble">{bodyOf(tpl)}</div></div>{Array.from({length:nv},(_,i)=><Field key={i} label={`Value for {{${i+1}}}`}><input value={pm[i]||''} onChange={e=>{const a=[...pm];a[i]=e.target.value;setPm(a)}}/></Field>)}</>}
      <button className="btn" disabled={b||!tpl||pm.filter(Boolean).length<nv} onClick={()=>send({template_id:tid,params:pm.slice(0,nv)})}>Send template</button></>}</div></>}</div></div></>}
