import {useState,useEffect} from 'react';import {Link,useNavigate,useSearchParams} from 'react-router-dom';import {api,session} from '../api.js';import {Field} from '../ui.jsx';
function Box({title,sub,children,foot}){return <div className="auth"><div className="authbox"><div className="brand">Thudhuvan</div><p className="muted">WhatsApp broadcasts and customer inbox for your business.</p>
 <div className="card"><h2>{title}</h2>{sub&&<p className="muted">{sub}</p>}<div style={{height:12}}/>{children}</div><p className="muted" style={{textAlign:'center'}}>{foot}</p></div></div>}
const useForm=init=>{const [v,set]=useState(init);return [v,k=>e=>set({...v,[k]:e.target.value})]};
export function Login(){const [v,on]=useForm({email:'',password:''}),[err,setE]=useState(''),[b,setB]=useState(false),nav=useNavigate();
 const go=async e=>{e.preventDefault();setE('');setB(true);try{const r=await api('/auth/login',{method:'POST',body:v});if(!r.workspaces.length){await api('/auth/logout',{method:'POST'});throw new Error('This account is not part of any workspace.')}const w=r.workspaces[0];session.set({workspace:w?.id,workspaceName:w?.name,role:w?.role,workspaces:r.workspaces});const p=sessionStorage.getItem('pending_invite');nav(p?'/accept-invite?token='+p:'/')}catch(x){setE(x.message)}setB(false)};
 return <Box title="Sign in" foot={<>New here? <Link to="/register">Create a workspace</Link></>}><form onSubmit={go}>{err&&<div className="errbox">{err} {/Verify your email/.test(err)&&<button type="button" className="btn sm ghost" onClick={async()=>{const r=await api('/auth/resend-verification',{method:'POST',body:{email:v.email}});setE(r.message)}}>Resend email</button>}</div>}
  <Field label="Email"><input type="email" required autoComplete="username" value={v.email} onChange={on('email')}/></Field>
  <Field label="Password"><input type="password" required autoComplete="current-password" value={v.password} onChange={on('password')}/></Field>
  <button className="btn" disabled={b} style={{width:'100%',justifyContent:'center'}}>{b?'Signing in…':'Sign in'}</button><p style={{marginTop:12}}><Link to="/forgot">Forgot password?</Link></p></form></Box>}
export function Register(){const [v,on]=useForm({email:'',password:'',workspace:''}),[err,setE]=useState(''),[done,setD]=useState(null),[b,setB]=useState(false);
 const go=async e=>{e.preventDefault();setE('');setB(true);try{setD(await api('/auth/register',{method:'POST',body:v}))}catch(x){setE(x.message)}setB(false)};
 if(done){const u=done.dev_verify_link&&new URL(done.dev_verify_link);return <Box title="Check your email" foot={<Link to="/login">Back to sign in</Link>}><div className="okbox">{done.message}</div>{u&&<p className="muted">Development mode: <a href={u.pathname+u.search}>verify now</a></p>}</Box>}
 return <Box title="Create your workspace" foot={<>Have an account? <Link to="/login">Sign in</Link></>}><form onSubmit={go}>{err&&<div className="errbox">{err}</div>}
  <Field label="Business name"><input required minLength={2} value={v.workspace} onChange={on('workspace')}/></Field><Field label="Work email"><input type="email" required value={v.email} onChange={on('email')}/></Field>
  <Field label="Password" hint="At least 8 characters"><input type="password" required minLength={8} autoComplete="new-password" value={v.password} onChange={on('password')}/></Field>
  <button className="btn" disabled={b} style={{width:'100%',justifyContent:'center'}}>{b?'Creating…':'Create workspace'}</button></form></Box>}
export function Forgot(){const [email,setE]=useState(''),[msg,setM]=useState('');
 return <Box title="Reset password" foot={<Link to="/login">Back to sign in</Link>}>{msg?<div className="okbox">{msg}</div>:<form onSubmit={async e=>{e.preventDefault();setM((await api('/auth/forgot',{method:'POST',body:{email}})).message)}}>
  <Field label="Email"><input type="email" required value={email} onChange={e=>setE(e.target.value)}/></Field><button className="btn">Send reset link</button></form>}</Box>}
export function Reset(){const [sp]=useSearchParams(),[pw,setP]=useState(''),[err,setE]=useState(''),[ok,setOk]=useState(false);
 return <Box title="Choose a new password" foot={<Link to="/login">Sign in</Link>}>{ok?<div className="okbox">Password updated. You can sign in now.</div>:<form onSubmit={async e=>{e.preventDefault();try{await api('/auth/reset',{method:'POST',body:{token:sp.get('token'),password:pw}});setOk(true)}catch(x){setE(x.message)}}}>
  {err&&<div className="errbox">{err}</div>}<Field label="New password"><input type="password" minLength={8} required value={pw} onChange={e=>setP(e.target.value)}/></Field><button className="btn">Update password</button></form>}</Box>}
export function Verify(){const [sp]=useSearchParams(),[s,setS]=useState('Verifying…');
 useEffect(()=>{api('/auth/verify',{method:'POST',body:{token:sp.get('token')}}).then(()=>setS('ok')).catch(e=>setS(e.message))},[]);
 return <Box title="Email verification" foot={<Link to="/login">Go to sign in</Link>}>{s==='ok'?<div className="okbox">Your email is verified.</div>:<p>{s}</p>}</Box>}
