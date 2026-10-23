import nodemailer from 'nodemailer';import {env} from './lib.js';
export const outbox=[]; // populated only when MAIL_MODE=capture (tests)
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let tx;const transport=()=>tx??=env.SMTP_HOST?nodemailer.createTransport({host:env.SMTP_HOST,port:+env.SMTP_PORT||587,secure:+env.SMTP_PORT===465,auth:env.SMTP_USER?{user:env.SMTP_USER,pass:env.SMTP_PASS}:undefined}):env.MAIL_MODE==='capture'?nodemailer.createTransport({jsonTransport:true}):null;
export async function sendMail(to,subject,text,button){
 const html=`<div style="font-family:Arial,sans-serif;max-width:480px"><h2 style="color:#12203a">Thudhuvan</h2><p>${esc(text).replace(/\n/g,'<br>')}</p>${button?`<p><a href="${esc(button.url)}" style="background:#0f7a64;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${esc(button.label)}</a></p><p style="color:#62708a;font-size:12px">Or paste this link into your browser:<br>${esc(button.url)}</p>`:''}</div>`;
 const t=transport();
 if(!t){if(env.NODE_ENV!=='production')console.log(`EMAIL to ${to}: ${subject} ${button?.url||''}`);else console.error('Email not sent: SMTP is not configured');return false}
 try{await t.sendMail({from:env.MAIL_FROM||'Thudhuvan <no-reply@localhost>',to,subject,text:`${text}\n\n${button?button.url:''}`,html});if(env.MAIL_MODE==='capture')outbox.push({to,subject,url:button?.url});return true}
 catch(e){console.error('Email failed:',e.message);return false}} // email trouble must never break sign-up or invites
export const mailVerify=(to,t)=>sendMail(to,'Verify your Thudhuvan email','Welcome to Thudhuvan. Confirm your email address to finish setting up your workspace.',{label:'Verify email',url:`${env.APP_URL}/verify?token=${t}`});
export const mailReset=(to,t)=>sendMail(to,'Reset your Thudhuvan password','We received a request to reset your password. The link works for one hour. If this was not you, you can ignore this email.',{label:'Reset password',url:`${env.APP_URL}/reset?token=${t}`});
export const mailInvite=(to,ws,by,t)=>sendMail(to,`${by} invited you to ${ws} on Thudhuvan`,`${by} invited you to join "${ws}". Sign in (or create an account) with this email address, then accept the invitation. The link works for 7 days.`,{label:'Accept invitation',url:`${env.APP_URL}/accept-invite?token=${t}`});
