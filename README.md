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
| 2. Transactions | Entry/edit incl. splits, filtered list, saved filters, dashboard, offline entry | **Done** |
| 3. Reports and migration | Seven reports, CSV/PDF export, migration from the old system (CSV import done) | Next |
| 4. Later | Role editor, budgets, recurring transactions, receipts, bank CSV import (Nordea done) | |

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

In development both servers read `@finance/shared` straight from
`packages/shared/src` (the `development` export condition), so changes there
apply without a build step. Production, tests and type checks use the built
`packages/shared/dist`; the root `build`, `test` and `typecheck` scripts build it first.

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

## API

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
| Transactions | `GET/POST /transactions`, `GET/PUT/DELETE /transactions/:id` | See below |
| Saved filters | `GET/POST /saved-filters`, `PATCH/DELETE /saved-filters/:id` | Per user; `filter` uses the list query fields |
| Dashboard | `GET /dashboard?month=YYYY-MM` | Month and previous month totals, six-month trend, expense by top-level category, recent transactions |
| Import | `POST /import/legacy`, `POST /import/bank/preview`, `POST /import/bank/commit` | CSV export of the old app and bank CSV files, see below |

### Transactions

- Amounts are integers in øre and always positive; the type gives the sign.
- Expense and income have one or more `lines` (`categoryId`, `amount`, `memo`,
  `tagIds`); more than one line is a split. The amount is the sum of the lines
  (if `amount` is sent too, it must match). Expense lines use expense
  categories; income lines use income or expense categories (a refund can go
  back to the category it was spent in). `categoryId: null` is uncategorised.
- Transfers have `toAccountId` and `amount` and no lines.
- `recipientId`, or `recipientName` to use an existing recipient with that name
  (case-insensitive) or create one.
- `PUT` replaces the whole transaction, lines included.
- `clientId` (UUID) makes a create idempotent: posting the same `clientId`
  again returns the stored transaction (200) instead of a duplicate.
- `GET /transactions` filters: `from`, `to`, `accountId` (either side of a
  transfer), `categoryId` (with subcategories), `uncategorized=true`,
  `recipientId`, `tagId`, `type`, `status`, `minAmount`, `maxAmount` (øre), `q`
  (description, recipient name, line memo), plus `limit` (≤ 500) and `offset`.
  Returns `{ items, count, income, expense, net }`; with a category or tag
  filter the totals count only the matching lines. Newest first.

### Importing from the old app

The old PersonalFinanceWPF app writes a `finance-export-…` folder of CSV files
(**File → Export to CSV**; format in the "Legacy CSV export format" doc). In
**Settings → Import from the old app**, choose that folder: the app shows a
preview (new, merged and already imported rows per table) and imports only
after you confirm. `POST /import/legacy` takes `{ files: { "<name>.csv": text, … }, dryRun }`
and needs `settings:admin`.

- Everything is one database transaction: an invalid row (unknown reference,
  line sum not matching, wrong category kind, unknown format version) rejects
  the whole import with a list of problems, and nothing is written.
- Every row keeps its old id in `legacy_id`, so importing the same folder again
  skips what is already there.
- Accounts, recipients and tags with the same name (case-insensitive), and
  categories with the same kind, parent and name, become one row. This also
  merges into rows created here before the import.
- Opening balances are 0, as in the old app; `raw/` and the old import rules are not used.
- Keep exports out of git: `data_exports/` is ignored.

### Importing a bank's CSV file

**Transactions → Import from bank** takes the CSV file the bank's website
exports (Nordea for now). Every row is shown for review first: tick which rows
to import and change date, type (expense, income or transfer), recipient,
category and description. Nothing is saved until **Import N transactions**.
The review is kept in the browser's `localStorage`, so a reload loses nothing.

- `POST /import/bank/preview` `{ content, fileName?, format?, accountId? }`
  detects the format from the header row and returns each row with a
  suggestion: type from the sign; recipient by name (case-insensitive) with its
  default or last-used category; a transfer when the other account number is
  written in one of our accounts' name or notes; and `duplicateOf` when the
  account already has a transaction with the same date and amount (those rows
  start unselected). Reserved (not yet booked) rows have no date and start
  unselected too. Writes nothing.
- `POST /import/bank/commit` `{ rows: [{ line, transaction }], saveRecipientDefaults }`
  takes normal transaction bodies and saves them in one database transaction:
  an invalid row saves nothing and the error names its line. Rows carry a
  `clientId`, so a retry does not duplicate. With `saveRecipientDefaults`, a
  recipient without a default category gets the category chosen for it.
- Both need `transactions:write`.
- Accounts have no account number field. Put the number (e.g. `6580.70.56411`)
  in the account's name or notes and the account is picked automatically; the
  browser also remembers the account chosen for each number.
- Another bank: add a parser in `apps/api/src/lib/bankImport/` implementing
  `BankFormatParser` (`format.ts`), list it in `formats.ts`, and add its id to
  `BANK_FORMATS` in `@finance/shared`.

## Offline use

The service worker caches the app and the last API responses it saw, so the
installed app opens and shows lists offline. A new transaction saved without a
connection is queued in the browser (`localStorage`, see
`apps/web/src/lib/offline.ts`) and sent when the app is online again; the
`clientId` makes retries safe. Unsent transactions are listed at the top of
**Transactions**, where they can be edited or removed. Editing or deleting a
stored transaction needs a connection.
