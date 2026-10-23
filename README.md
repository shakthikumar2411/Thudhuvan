# Thudhuvan (API + web app, phases 1-8)
**Run locally without Docker (recommended for development):**
1. Install PostgreSQL 17 locally.
2. Create `.env` from the sample and set a local database URL, e.g. `postgres://thudhuvan:thudhuvan@localhost:5432/thudhuvan`.
3. Run `npm install`.
4. Start the app with `npm run local`.
5. API on :3000, health at /health.

**Run locally with Docker:** `cp .env.example .env` (set JWT_SECRET and ENCRYPTION_KEY=`openssl rand -hex 32`), then `docker compose up --build`. API on :3000, health at /health.
**Deploy (Render/Railway/VPS):** create a Postgres, set the .env variables, deploy the Dockerfile (it runs migrations on start). Point Meta's webhook to `https://YOUR_HOST/webhooks/whatsapp` using META_VERIFY_TOKEN and subscribe to `messages`. Run ONE instance with WORKER_ENABLED=true (or several; claiming uses SKIP LOCKED).
**Web app:** lives in `web/` (React + Vite). The Docker build compiles it and the API serves it, so one deployment runs everything. For UI development: run the API on :3000, then `cd web && npm install && npm run dev` (http://localhost:5173 proxies /api).
**Tests:** `npm install && npm test` runs 40+ checks against a real embedded Postgres with a mocked Meta API.
**Email:** set SMTP_HOST/PORT/USER/PASS/MAIL_FROM (any SMTP provider: SES, Brevo, Mailgun, Zoho...). Verification, password reset and team invites are emailed. Without SMTP, links are only printed to the log outside production, and production refuses to boot unless ALLOW_NO_EMAIL=true.

## API (all under /api, Bearer token; tenant = workspace of the token)
Auth: register, verify, login (5 failed attempts lock the account for 15 min), forgot, reset | WhatsApp: connect, accounts, sync-templates, templates
Contacts: CRUD, import (csv/xlsx, dry_run), consent, opt-out | Groups
Campaigns: create, preview, launch{confirm:true}, pause, resume, cancel, retry-failed, detail, recipients, export.csv
Billing: plan, usage, change-plan | Team: invite, accept, remove | Admin: workspaces, manual subscription | Inbox: conversations, messages, reply (24h window enforced), status | audit | admin/metrics

## Launch checklist
1. Generate secrets: `openssl rand -hex 32` for ENCRYPTION_KEY, a 40+ char JWT_SECRET. Set NODE_ENV=production, APP_URL=https://your-domain. The server refuses to start in production with weak or missing config and lists every problem.
2. Use HTTPS only (Render/Railway provide it). Session cookies are HttpOnly, SameSite=Lax and Secure in production; state-changing requests need the CSRF header (the web app sends it automatically).
3. Configure SMTP and send yourself a test sign-up. Set your domain's SPF/DKIM so mail doesn't land in spam.
4. Meta: set webhook URL `https://YOUR_HOST/webhooks/whatsapp`, verify token = META_VERIFY_TOKEN, subscribe to `messages`; set META_APP_SECRET.
5. Turn on automated database backups at your host (daily, 7+ days) and do one test restore. Losing the database loses consent records.
6. Monitor GET /health (uptime check) and GET /api/admin/metrics (queue depth, stuck sends, webhook errors).
7. The server shuts down gracefully on SIGTERM (finishes the current send batch), so rolling deploys are safe. Failed webhooks are retried automatically (up to 5 times).
8. Workspace owners can permanently delete their workspace (Settings). Review your privacy policy and retention promises against this behaviour before launch.

## Plans & billing
Three seeded plans (trial 14 days, Starter, Growth) in the `plans` table; edit prices/limits there. Limits enforced: campaign messages per period, contacts, team members, WhatsApp numbers. Failed/cancelled sends and inbox replies don't count. Expired/past-due/cancelled subscriptions block new campaigns only; inbox keeps working.
**Online payment is NOT connected.** In production, `change-plan` returns 501 until a payment provider (e.g. Razorpay/Stripe) adapter is added in src/billing.js; until then activate plans manually with `PUT /api/admin/workspaces/:id/subscription` (set `is_platform_admin=true` on your own user in the DB). Renewal is manual until the provider's webhooks are wired.

## Known limits (by design, for later phases)
- Worker rate is global (WORKER_RATE msg/s), not yet per-sender tier. Poster images need a public https link (no upload storage yet).
- Templates with media headers are blocked at validation. Inbound media is stored as a placeholder.
- A worker crash mid-send marks that recipient INTERRUPTED for manual retry instead of risking a duplicate send.
- No billing, plans or RBAC beyond owner/member.
- Team invites need the invitee to register first, then open the invite link with the same email.
- The UI has been compiled and served end to end, but not yet checked in a real browser across devices. Do a manual pass on phone + desktop.
- Not yet done: load testing, a third-party security review, rate limits beyond sign-in, virus scanning for future image uploads.
