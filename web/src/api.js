import {useState,useEffect,useCallback,useRef} from 'react';
const KEY='thd_auth';
export const session={get:()=>{try{return JSON.parse(localStorage.getItem(KEY))}catch{return null}},set:v=>localStorage.setItem(KEY,JSON.stringify(v)),clear:()=>localStorage.removeItem(KEY)};
export async function api(path,{method='GET',body,form,raw}={}){
 const a=session.get(),h={},cs=document.cookie.split('; ').find(c=>c.startsWith('thd_csrf='));if(cs)h['X-CSRF-Token']=cs.split('=')[1];if(a?.workspace)h['X-Workspace-Id']=a.workspace; // session itself is an HttpOnly cookie; JS never sees the token
 if(body)h['Content-Type']='application/json';
 let r;try{r=await fetch('/api'+path,{method,headers:h,body:form||(body?JSON.stringify(body):undefined)})}catch{throw new Error('Cannot reach the server. Check your connection.')}
 if(raw)return r;if(r.status===204)return null;
 const j=await r.json().catch(()=>null);
 if(r.status===401&&a){session.clear();location.href='/login'}
 if(!r.ok){const e=new Error(j?.error||j?.errors?.[0]||'Something went wrong. Try again.');e.status=r.status;e.data=j;throw e}
 return j}
export function useFetch(path,{every,skip}={}){
 const [s,set]=useState({data:null,error:null,loading:true}),n=useRef(0);
 const load=useCallback(async(quiet)=>{if(skip)return;const id=++n.current;if(!quiet)set(x=>({...x,loading:true}));
  try{const d=await api(path);if(id===n.current)set({data:d,error:null,loading:false})}catch(e){if(id===n.current)set(x=>({...x,error:e.message,loading:false}))}},[path,skip]);
 useEffect(()=>{load();if(!every||skip)return;const t=setInterval(()=>load(true),every);return()=>clearInterval(t)},[load,every,skip]);
 return {...s,reload:()=>load(true)}}
export function useDebounced(v,ms=300){const [d,set]=useState(v);useEffect(()=>{const t=setTimeout(()=>set(v),ms);return()=>clearTimeout(t)},[v,ms]);return d}
