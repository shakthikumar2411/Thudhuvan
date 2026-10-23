import {Routes,Route,Navigate,NavLink,Outlet,Link,useNavigate} from 'react-router-dom';
import {api,session,useFetch} from './api.js';import {Login,Register,Forgot,Reset,Verify} from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';import Contacts from './pages/Contacts.jsx';import Groups from './pages/Groups.jsx';
import {CampaignList,CampaignBuilder,CampaignDetail} from './pages/Campaigns.jsx';import Inbox from './pages/Inbox.jsx';import {Settings,Templates,Audit} from './pages/Settings.jsx';import {Billing,AcceptInvite} from './pages/Billing.jsx';
function Shell(){const s=session.get(),nav=useNavigate();
 const {data}=useFetch('/conversations/unread-count',{every:15000,skip:!s}),{data:bill}=useFetch('/billing',{every:60000,skip:!s});
 if(!s)return <Navigate to="/login" replace/>;
 const L=[['/','Dashboard'],['/contacts','Contacts'],['/groups','Groups'],['/templates','Templates'],['/campaigns','Campaigns'],['/inbox','Inbox'],['/billing','Plan & usage'],['/settings','Settings']];
 const ws=s.workspaces||[],switchTo=id=>{const w=ws.find(x=>x.id===id);session.set({...s,workspace:w.id,workspaceName:w.name,role:w.role});location.href='/'};
 const near=bill&&bill.usage.messages>=bill.limits.monthly_messages*.9;
 return <div className="shell"><nav className="side" aria-label="Main"><div className="brand">Thudhuvan<small>{ws.length>1?<select aria-label="Workspace" value={s.workspace} onChange={e=>switchTo(e.target.value)} style={{marginTop:6,padding:'4px 6px',fontSize:12}}>{ws.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>:s.workspaceName}</small></div>
  {L.map(([to,l])=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>isActive?'on':''}>{l}{to==='/inbox'&&data?.unread>0&&<span className="nb">{data.unread}</span>}</NavLink>)}
  <div className="sp"/><a href="#" onClick={async e=>{e.preventDefault();await api('/auth/logout',{method:'POST'}).catch(()=>{});session.clear();nav('/login')}}>Sign out</a></nav>
  <main className="main">{bill&&!bill.canSend&&<div className="errbox">{bill.message} <Link to="/billing">View plans</Link></div>}{bill?.canSend&&near&&<div className="errbox" style={{color:'var(--warn)',borderColor:'var(--warn)'}}>You have used {bill.usage.messages} of {bill.limits.monthly_messages} campaign messages this period. <Link to="/billing">View plans</Link></div>}<Outlet/></main></div>}
export default function App(){return <Routes>
 <Route path="/login" element={<Login/>}/><Route path="/register" element={<Register/>}/><Route path="/forgot" element={<Forgot/>}/><Route path="/reset" element={<Reset/>}/><Route path="/verify" element={<Verify/>}/><Route path="/accept-invite" element={<AcceptInvite/>}/>
 <Route element={<Shell/>}><Route index element={<Dashboard/>}/><Route path="contacts" element={<Contacts/>}/><Route path="groups" element={<Groups/>}/><Route path="templates" element={<Templates/>}/>
  <Route path="campaigns" element={<CampaignList/>}/><Route path="campaigns/new" element={<CampaignBuilder/>}/><Route path="campaigns/:id" element={<CampaignDetail/>}/>
  <Route path="inbox" element={<Inbox/>}/><Route path="billing" element={<Billing/>}/><Route path="settings" element={<Settings/>}/><Route path="audit" element={<Audit/>}/></Route>
 <Route path="*" element={<Navigate to="/" replace/>}/></Routes>}
