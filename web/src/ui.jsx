import {createContext,useContext,useState,useCallback,useEffect,useRef} from 'react';
const T=createContext(null);export const useToast=()=>useContext(T);
export function ToastProvider({children}){const [list,set]=useState([]);
 const push=useCallback((msg,kind='ok')=>{const id=Math.random();set(l=>[...l,{id,msg,kind}]);setTimeout(()=>set(l=>l.filter(x=>x.id!==id)),4200)},[]);
 return <T.Provider value={push}>{children}<div className="toasts" role="status" aria-live="polite">{list.map(t=><div key={t.id} className={'toast '+t.kind}>{t.msg}</div>)}</div></T.Provider>}
export function Modal({title,onClose,children,wide}){const ref=useRef();
 useEffect(()=>{const k=e=>e.key==='Escape'&&onClose();document.addEventListener('keydown',k);ref.current?.querySelector('input,select,textarea,button')?.focus();return()=>document.removeEventListener('keydown',k)},[]);
 return <div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div ref={ref} className={'modal'+(wide?' wide':'')} role="dialog" aria-modal="true" aria-label={title}>
  <div className="mhead"><h3>{title}</h3><button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button></div>{children}</div></div>}
export function Confirm({title,text,action='Confirm',danger,onYes,onClose}){const [b,setB]=useState(false);
 return <Modal title={title} onClose={onClose}><p>{text}</p><div className="actions"><button className="btn ghost" onClick={onClose}>Cancel</button>
  <button className={'btn '+(danger?'danger':'')} disabled={b} onClick={async()=>{setB(true);try{await onYes()}finally{setB(false);onClose()}}}>{action}</button></div></Modal>}
export const Field=({label,hint,children})=><label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;
export const Card=({title,right,children,pad=true})=><section className="card">{(title||right)&&<div className="chead"><h3>{title}</h3>{right}</div>}<div className={pad?'cbody':''}>{children}</div></section>;
export const PageHead=({title,sub,children})=><div className="phead"><div><h1>{title}</h1>{sub&&<p className="muted">{sub}</p>}</div><div className="pact">{children}</div></div>;
export const Spinner=()=><div className="spin" role="status" aria-label="Loading"/>;
export const Empty=({title,text,children})=><div className="empty"><b>{title}</b><p className="muted">{text}</p>{children}</div>;
export const ErrorBox=({msg,retry})=>msg?<div className="errbox">{msg} {retry&&<button className="btn sm ghost" onClick={retry}>Retry</button>}</div>:null;
const TONE={active:'good',APPROVED:'good',completed:'good',delivered:'good',read:'good',opted_in:'good',sending:'info',queued:'info',submitted:'info',sent:'info',scheduled:'info',processing:'info',open:'info',pending:'warn',PENDING:'warn',paused:'warn',none:'warn',draft:'mute',cancelled:'mute',resolved:'mute',failed:'bad',REJECTED:'bad',restricted:'bad',completed_with_errors:'warn'};
const LABEL={completed_with_errors:'Completed with errors',opted_in:'Opted in',none:'No consent',APPROVED:'Approved',REJECTED:'Rejected',PENDING:'Pending'};
export const Badge=({s,children})=><span className={'badge '+(TONE[s]||'mute')}>{children||LABEL[s]||s}</span>;
export const phone=p=>p?'+'+p:'';
export const ago=d=>{if(!d)return '';const s=(Date.now()-new Date(d))/1e3;if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+' min ago';if(s<86400)return Math.floor(s/3600)+' h ago';return new Date(d).toLocaleDateString()};
export const when=d=>d?new Date(d).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'';
export const Bar=({v,max})=><div className="bar" role="progressbar" aria-valuenow={v} aria-valuemax={max}><i style={{width:(max?Math.min(100,v/max*100):0)+'%'}}/></div>;
export const Stat=({n,l,tone})=><div className={'stat '+(tone||'')}><b>{n??'–'}</b><span>{l}</span></div>;
