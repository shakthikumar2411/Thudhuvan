import './env.js';
import express from 'express';import path from 'path';import fs from 'fs';import crypto from 'crypto';import {fileURLToPath} from 'url';import helmet from 'helmet';import rateLimit from 'express-rate-limit';
import {api} from './routes.js';import {webhook} from './webhook.js';import {startWorker} from './worker.js';import {pool} from './lib.js';
const app=express();app.set('trust proxy',1);app.use(helmet());
app.use((req,res,next)=>{req.id=crypto.randomUUID().slice(0,8);res.setHeader('X-Request-Id',req.id);const t=Date.now();
 res.on('finish',()=>{if(req.path!=='/health')console.log(JSON.stringify({id:req.id,m:req.method,p:req.path,s:res.statusCode,ms:Date.now()-t}))});next()}); // path only: never log query strings (tokens)
app.use(express.json({limit:'1mb',verify:(req,_r,buf)=>{req.rawBody=buf}}));
app.use('/webhooks/whatsapp',webhook);
app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:60}));
app.get('/health',async(_q,r)=>{try{await pool.query('select 1');r.json({ok:true})}catch{r.status(503).json({ok:false})}});
app.use('/api',api);
const dist=path.join(path.dirname(fileURLToPath(import.meta.url)),'../web/dist');
if(fs.existsSync(dist)){app.use(express.static(dist,{maxAge:'1h'}));app.get('*',(q,r,n)=>/^\/(api|webhooks)\b/.test(q.path)?n():r.sendFile(path.join(dist,'index.html')))}
app.use((e,req,res,_n)=>{if(!e.status)console.error(req.id,e);res.status(e.status||500).json({error:e.status?e.message:`Something went wrong. Try again. Reference: ${req.id}`})});
let stop=async()=>{};const srv=app.listen(process.env.PORT||3000,()=>{console.log('Thudhuvan API up');stop=startWorker()});
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,async()=>{console.log('Shutting down');setTimeout(()=>process.exit(1),15000).unref();srv.close();await stop();await pool.end();process.exit(0)});
