// Fail fast: refuse to boot in production with unsafe or missing configuration.
const e=process.env,errs=[];
if(e.NODE_ENV==='production'){
 if((e.JWT_SECRET||'').length<32)errs.push('JWT_SECRET must be at least 32 characters');
 if(!/^[0-9a-f]{64}$/i.test(e.ENCRYPTION_KEY||''))errs.push('ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)');
 if(!e.DATABASE_URL)errs.push('DATABASE_URL is required');
 if(!/^https:\/\//.test(e.APP_URL||''))errs.push('APP_URL must be an https:// URL');
 if(!e.META_APP_SECRET)errs.push('META_APP_SECRET is required to verify WhatsApp webhooks');
 if(!e.META_VERIFY_TOKEN)errs.push('META_VERIFY_TOKEN is required');
 if(!e.SMTP_HOST&&e.ALLOW_NO_EMAIL!=='true')errs.push('SMTP_HOST is required so users can verify email (or set ALLOW_NO_EMAIL=true)');
}
if(errs.length){console.error('Configuration problems:\n - '+errs.join('\n - '));process.exit(1)}
