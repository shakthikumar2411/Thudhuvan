// Provider interface (NFR-023): swap this file to change provider.
import crypto from 'crypto';import {env,decrypt} from './lib.js';
const G=()=>`https://graph.facebook.com/${env.META_GRAPH_VERSION||'v21.0'}`;
async function call(path,token,opts={}){const r=await fetch(G()+path,{...opts,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
 const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.error?.message||'Provider error');e.code=j.error?.code;e.temporary=r.status===429||r.status>=500||[4,80007,130429,131048].includes(j.error?.code);throw e}return j}
export const tokenOf=a=>decrypt(a.token_enc);
export const fetchPhone=(pid,token)=>call(`/${pid}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,token);
export const listTemplates=(waba,token)=>call(`/${waba}/message_templates?limit=200&fields=name,language,status,category,components`,token);
export const send=(a,payload)=>call(`/${a.phone_number_id}/messages`,tokenOf(a),{method:'POST',body:JSON.stringify({messaging_product:'whatsapp',...payload})});
export const sendText=(a,to,body)=>send(a,{to,type:'text',text:{body}});
export const sendTemplate=(a,to,name,lang,params=[])=>send(a,{to,type:'template',template:{name,language:{code:lang},components:params.length?[{type:'body',parameters:params.map(t=>({type:'text',text:t}))}]:[]}});
export const sendImage=(a,to,link,caption)=>send(a,{to,type:'image',image:{link,caption}});
export function verifySignature(raw,header){if(!env.META_APP_SECRET||!header)return false;
 const exp='sha256='+crypto.createHmac('sha256',env.META_APP_SECRET).update(raw).digest('hex');
 const a=Buffer.from(exp),b=Buffer.from(header);return a.length===b.length&&crypto.timingSafeEqual(a,b)}
