# Finance

Personal finance system for the household: accounts, transactions with split
lines, recipients, nested categories, tags and reports. It replaces the old
.NET system and runs as a website that installs on Android as a PWA.

- Live: `https://finance.ovrebekk.no` (home server `ubuntu-immich`)
- Spec: "Finance System – Specification Proposal" (Claude doc)
- Same stack and deployment model as the wine organizer (`wine.ovrebekk.no`)

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1. Foundation | Repo, SQLite schema (incl. users, roles, transactions, split lines, per-line tags), login, CRUD for accounts, categories, recipients, tags, deploy files | **Done** |
| 2. Transactions | Entry/edit incl. splits, filtered list, saved filters, dashboard, offline entry | Next |
| 3. Reports and migration | Seven reports, CSV/PDF export, migration from the old SQLite file | |
| 4. Later | Role editor, budgets, recurring transactions, receipts, bank CSV import | |

## Repository layout

```
apps/api          Fastify 5 API + serves the built web app (Node 24, TypeScript)
  drizzle/        SQL migrations (run automatically on start)
  src/db/         Drizzle schema and database setup
  src/routes/     /api/v1/* route modules
  src/lib/        config, auth/permissions, backups, bootstrap
  src/scripts/    set-password
apps/web          React 19, Vite 7, React Router 7, TanStack Query 5, plain CSS, PWA
packages/shared   Zod schemas, permissions, money and category-tree helpers
deploy/nginx      nginx site file for finance.ovrebekk.no (+ reference copies)
```

## Development

Requires Node 22+ (production uses Node 24).

```bash
npm install
npm run dev:api     # API on http://127.0.0.1:3000 (reads ../../.env if present)
npm run dev:web     # Vite on http://localhost:5173, proxies /api to the API
```

For a first login in development, create `.env` in the repo root:

```
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=something-long
```

Other commands:

```bash
npm test            # Vitest (shared + API)
npm run typecheck
npm run build       # shared → api → web
npm run db:generate # new migration after editing apps/api/src/db/schema.ts
```

> drizzle-kit 0.31 mis-quotes the expression index `categories_sibling_name_unique`.
> `apps/api/drizzle/0000_init.sql` was fixed by hand; check that index in any
> future generated migration that touches `categories`.

## Deployment (ubuntu-immich)

Reuses the wine organizer's setup: nginx on 443 terminates TLS with the
`*.ovrebekk.no` wildcard certificate and proxies to the container on
`127.0.0.1:3005`. DNS and certificates need no changes.

### First time

```bash
# 1. Code (snap Docker only sees $HOME)
git clone <repo-url> ~/www-finance
cd ~/www-finance

# 2. Secrets
cp .env.example .env
openssl rand -hex 32          # paste as SESSION_SECRET
nano .env                     # SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME
chmod 600 .env

# 3. Port 3005 must be free (3000 = wine organizer, 2283 = Immich)
ss -ltn | grep -E ':3005\b' || echo "3005 is free"

# 4. Build and start
docker compose up -d --build
docker compose logs -f        # expect "Created first user with the Owner role"
curl -s http://127.0.0.1:3005/api/health

# 5. nginx
sudo cp deploy/nginx/finance /etc/nginx/sites-available/finance
sudo ln -s /etc/nginx/sites-available/finance /etc/nginx/sites-enabled/finance
sudo nginx -t && sudo systemctl reload nginx
```

Then open `https://finance.ovrebekk.no`, sign in, and on Android choose
Chrome menu → **Install app**.

After the first login you can remove `ADMIN_PASSWORD` from `.env`; it is only
used when no user exists.

### Updates

```bash
cd ~/www-finance && git pull && docker compose up -d --build
```

Migrations run automatically on start.

### Configuration (`.env`)

| Variable | Default | Notes |
| --- | --- | --- |
| `APP_PORT` | `3005` | Host port on 127.0.0.1 |
| `SESSION_SECRET` | — | Required in production, ≥ 32 characters |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | — | Create the first user (Owner role) if none exists |
| `BACKUP_KEEP` | `30` | Nightly backups kept |
| `BACKUPS_ENABLED` | `true` in production | |
| `TZ` | `Europe/Oslo` | Backup time is 03:00 in this zone |

### Operations

```bash
# Reset a password (prompts if the password is left out)
docker compose exec app node apps/api/dist/scripts/set-password.js you@example.com

# Backups (VACUUM INTO, nightly at 03:00) live in the volume under /app/data/backups
docker compose exec app ls -l /app/data/backups
docker compose cp app:/app/data/backups ./backups-copy   # copy off the server, e.g. to the NAS

# Restore: stop the app, replace finance.sqlite in the volume with a backup, start again
docker compose stop app
docker compose cp ./finance-YYYYMMDD-HHMMSS.sqlite app:/app/data/finance.sqlite
docker compose start app
# (A clean stop checkpoints the WAL; if finance.sqlite-wal/-shm files remain in the volume, remove them before starting.)
```

A backup can also be downloaded from **Settings → Download backup**.

### Known gotchas

- Missing `.env`: compose fails with `env file .env not found`; an empty
  `SESSION_SECRET` makes the app exit with "SESSION_SECRET must be set…".
- "permission denied" on `docker.sock`: the user is not in the `docker` group yet.
- Never remove snap Docker: Immich's containers and volumes live in it.
- Port collisions: use 3005 (not 3000 or 2283).

## Security model (summary)

- Email + password login, argon2 hashes; unknown emails still compute a hash so
  timing does not reveal which emails exist.
- Encrypted session cookie (`finance_session`, `@fastify/secure-session`):
  httpOnly, SameSite=Lax, Secure in production, 30 days.
- Every API route except login and health runs `requireAuth` (401) and
  `requirePermission('<name>')` (403). Permissions live in
  `packages/shared/src/permissions.ts`; the Owner role is re-synced to hold all
  of them on every start, so adding roles later is a data change.
- Login rate-limited to 5 attempts per minute per IP; `trustProxy` on in production.
- All input validated with shared Zod schemas (400); 5xx errors are logged and
  return a generic message.
- Container port bound to loopback only; nginx adds HSTS, nosniff,
  `X-Frame-Options DENY` and `Referrer-Policy same-origin`.

## API (phase 1)

All under `/api/v1`, JSON, same-origin session cookie.

| Resource | Endpoints | Notes |
| --- | --- | --- |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | |
| Accounts | `GET/POST /accounts`, `GET/PATCH/DELETE /accounts/:id` | Balance computed; delete refused (409) when transactions exist – archive instead |
| Categories | `GET/POST /categories`, `GET/PATCH /categories/:id`, `DELETE /categories/:id?moveTo=` | Same-kind parents, no cycles; a used category or one with children needs `moveTo` |
| Recipients | `GET/POST /recipients`, `GET/PATCH/DELETE /recipients/:id`, `POST /recipients/:id/merge` | Delete refused when used – merge or archive |
| Tags | `GET/POST /tags`, `GET/PATCH/DELETE /tags/:id`, `POST /tags/:id/merge` | Delete removes the tag from lines |
| Settings | `GET /settings/backup`, `GET /users`, `GET /roles` | |
| Health | `GET /api/health` | No auth |
