#ArbidX Backend — Node.js + Express + MongoDB

The real API behind theArbidX Angular frontend. Implements JWT auth,
an auditable wallet ledger, a server-authoritative demo arbitrage
trading engine with live Socket.IO updates, the full admin API
(deposits/withdrawals approval, wallet credit/debit, audit logs), and
**daily admin-controlled profit/loss** — an admin sets a target net P&L
% for a date (per user or platform-wide) and the engine biases that
day's simulated positions toward it.

If you need PostgreSQL + Sequelize instead, see the separate
`ArbidX-pg-backend` build — same API surface and feature set, just a
different datastore. This is the MongoDB version.

## Stack

- Node.js + Express + TypeScript
- MongoDB + Mongoose (with multi-document transactions for every
  balance-affecting operation)
- JWT (access + refresh) + bcrypt
- Socket.IO (`socket.io` server + the frontend's `socket.io-client`)
- Zod for request validation

### A note on the WebSocket layer

An earlier version of this backend used the plain `ws` library instead
of Socket.IO, because at the time the frontend's `WebSocketService`
used RxJS's raw `webSocket()` client — Socket.IO's engine.io framing
isn't wire-compatible with a plain WebSocket connection, so the two
couldn't talk to each other. Both sides have since been updated:
`src/websocket/hub.ts` here uses `socket.io`, and the frontend's
`WebSocketService` now uses `socket.io-client` to match. If you're
pairing this backend with an older copy of the frontend, check that
its `WebSocketService` was updated too, or the connection will fail
silently.

## Setup

```bash
npm install
cp .env.example .env
# edit .env — at minimum set real JWT secrets before anything but local dev

# MongoDB: wallet transactions require a replica set (see .env.example).
# Easiest local option:
docker compose up -d

npm run seed   # creates the SUPER_ADMIN + demo USER from .env, plus sample data
npm run dev    # ts-node + nodemon, http://localhost:4000
```

Seeded logins (from `.env` — change these before any shared/deployed use):
- Admin: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (defaults to `admin@example.com` / `ChangeMe123!`)
- Demo user: `SEED_DEMO_EMAIL` / `SEED_DEMO_PASSWORD` (defaults to `demo@example.com` / `ChangeMe123!`)

## Wiring up the frontend

In the Angular project's `src/environments/environment.ts`:

```ts
export const environment = {
  ...
  useMockData: false,
  apiUrl: 'http://localhost:4000/api',
  wsUrl: 'http://localhost:4000',   // socket.io-client connects here, not wss://.../
};
```

No component code changes needed beyond that — every frontend service
already branches on `useMockData` and calls these exact endpoints, and
`WebSocketService` already uses `socket.io-client` to match this backend.

## How daily P&L control works

`POST /api/admin/daily-pnl` (SUPER_ADMIN only) upserts a row:
```json
{ "date": "2026-08-15", "userId": null, "targetPct": 3.5, "notes": "Promo day" }
```
- `userId: null` sets the **platform-wide default** for that date —
  applies to any user without their own row for the same date.
- `userId: "<id>"` sets a target for **one specific user** on that
  date, which takes precedence over the platform default.

Every ~1.2s tick, `arbitrageEngine.service.ts`'s `tick()` function:
1. Looks up today's bias for the trade's user (user-specific row →
   platform default → `null` if neither exists) via `getDailyBiasPct()`.
2. Computes `movementPct = noise + (bias * 0.03)`, where `noise` is the
   existing bounded random walk (-0.5% to +0.5%) and `0.03` is a
   deliberately gentle nudge factor — enough that many ticks over a
   full day trend the position's cumulative P&L toward the admin's
   target, without making any single tick look scripted.
3. SL/TP are still checked against the *actual* resulting P&L% every
   tick — a daily target doesn't override a user's own risk settings.

This is a heuristic, not an exact "end the day at precisely X%"
guarantee, since trades start/stop at different times and vary in
duration. It's tuned to feel directionally controlled while still
reading as a real, fluctuating market.

## Project layout

```
src/
├── config/          env.ts (typed env vars), db.ts (Mongo connection)
├── models/           Mongoose schemas — User, Wallet, WalletTransaction,
│                     Deposit, Withdrawal, Trade, BotSession, AdminAdjustment,
│                     AuditLog, Notification, BotConfig, ArbitrageOpportunityConfig,
│                     DailyPnlControl (new — daily admin-controlled P&L)
├── validators/        Zod request schemas
├── middleware/         requireAuth, requireRole, validateBody, error handling, rate limiting
├── services/
│   ├── walletLedger.service.ts     the ONLY place balances are ever mutated
│   ├── auth.service.ts              register/login/refresh, issues wallet on signup
│   ├── arbitrageEngine.service.ts   server-authoritative demo trading engine
│   ├── admin.service.ts             approvals, credit/debit, always ledger + audit log
│   └── notification.service.ts
├── controllers/        one per resource, thin — validation/business logic lives in services
├── routes/              REST endpoints, mounted under /api
├── websocket/hub.ts     per-user WS connections, auth via ?token=<accessToken>
└── scripts/seed.ts
```

## The wallet ledger (spec §34/§35/§42)

`wallet.balance` / `availableBalance` / `lockedBalance` are **never**
written directly anywhere in the codebase except inside
`walletLedger.service.ts`. Every mutation:
1. Opens a Mongo session/transaction (or joins one already in progress,
   e.g. inside `startTrade`).
2. Validates the operation won't drive a balance negative.
3. Writes the wallet update AND a `WalletTransaction` ledger row in the
   same transaction — if either fails, both roll back.

Deposits, withdrawals, trade investment/profit/loss, and admin
credit/debit all funnel through this. `AuditLog` additionally records
*who* (which admin) did *what* for anything admin-initiated.

## The arbitrage engine (spec §9–§13, §52, §53)

`arbitrageEngine.service.ts` is the server-side, authoritative version
of what the frontend's mock engine simulates locally. Angular never
computes P&L, prices, or balances — it only displays what this engine
publishes:
- `startTrade()` validates against `BotConfig` bounds and the user's
  available balance, locks the investment via the ledger, creates a
  `Trade` + `BotSession`, and starts a per-trade monitoring interval.
- Every ~1.2s, the monitor applies **bounded** random price movement
  (-0.5% to +0.5%, never unbounded randomness), updates the trade,
  and pushes a `trade:update` WS event.
- Stop Loss / Take Profit are checked every tick; hitting either closes
  the trade automatically with the correct `closeReason`.
- Closing a trade releases the locked investment and applies profit/loss
  as its own ledger entry — atomically, in one transaction.
- `resumeActiveTrades()` re-attaches monitors to any trade still marked
  `ACTIVE` in the DB after a server restart, so a redeploy doesn't
  silently freeze P&L updates (see the scaling caveat in that file's
  comment — this is in-process, not a distributed job queue).

Swapping in a real exchange integration later means writing a
`LiveTradingEngine` behind the same shape (`startTrade`/`stopTrade`/
`getMarketData`) and switching `TRADING_MODE=LIVE` — the controller
layer doesn't need to change.

## API surface (spec §38/§39)

All routes are prefixed `/api`. Full request/response shapes match the
TypeScript interfaces in the frontend's `core/models/index.ts`.

```
POST   /auth/register              POST   /auth/login
POST   /auth/refresh                POST   /auth/logout
POST   /auth/forgot-password         GET    /auth/me

GET    /users/me                     PUT    /users/me
PUT    /users/change-password

GET    /wallet                        GET    /wallet/transactions

POST   /deposits                      GET    /deposits            GET /deposits/:id
POST   /withdrawals                   GET    /withdrawals         GET /withdrawals/:id

POST   /trades/start                  POST   /trades/:id/stop
GET    /trades/active                  GET    /trades/history      GET /trades/:id

GET    /arbitrage/opportunities        POST   /arbitrage/start      (alias of /trades/start)

--- Admin (all require JWT + role ADMIN or SUPER_ADMIN) ---

GET    /admin/dashboard

GET    /admin/users                    GET    /admin/users/:id      PUT /admin/users/:id
PUT    /admin/users/:id/status
POST   /admin/users/:id/wallet/credit  POST   /admin/users/:id/wallet/debit

GET    /admin/deposits                 POST   /admin/deposits/:id/approve   POST /admin/deposits/:id/reject

GET    /admin/withdrawals
POST   /admin/withdrawals/:id/process   POST /admin/withdrawals/:id/approve
POST   /admin/withdrawals/:id/complete  POST /admin/withdrawals/:id/reject

GET    /admin/trades                    GET  /admin/trades/active
POST   /admin/trades/:id/close

GET    /admin/audit-logs

GET    /admin/bot-config                PUT /admin/bot-config             (SUPER_ADMIN only)
GET    /admin/arbitrage-opportunities   PUT /admin/arbitrage-opportunities (SUPER_ADMIN only)

GET    /admin/daily-pnl                 POST /admin/daily-pnl              (SUPER_ADMIN only — new feature)
```

## Security (spec §41)

- Passwords hashed with bcrypt (12 rounds); `passwordHash` has
  `select: false` in the schema and is never included in any response.
- JWT access tokens (15m default) + refresh tokens (7d default);
  `refreshTokenVersion` on the user document lets a password change or
  explicit logout-all invalidate every outstanding refresh token at once.
- `requireAuth` re-checks the user's current status in the DB on every
  request — a blocked account's existing access token stops working
  immediately, not just on next login.
- Helmet, CORS (configurable allow-list), and separate rate limits for
  general API traffic vs. auth endpoints (tighter, to slow credential
  stuffing).
- All request bodies validated with Zod before touching a controller;
  failures return 422 with field-level messages, never a raw stack trace.
- MongoDB via Mongoose parameterizes all queries — no raw string
  interpolation into queries anywhere in this codebase.

## Verification performed before delivery

- `npm run typecheck` — zero TypeScript errors across the entire codebase,
  including after the Socket.IO swap and DailyPnlControl addition.
- `npm run build` — full `tsc` emit succeeds, `dist/` produced cleanly.
- Server boots correctly and fails gracefully (clean error log, exit
  code 1) when MongoDB isn't reachable — re-verified after these
  changes, in the sandbox this was built in, which has no MongoDB
  installed. **I was not able to run this against a live MongoDB
  instance, connect a real Socket.IO client, or exercise the daily P&L
  bias end-to-end** — please run `npm run seed` and hit `/api/health`,
  then `/api/auth/login`, as your first smoke test once you have Mongo
  running locally, and specifically watch a trade's `trade:update`
  events arrive over Socket.IO before trusting that side of the swap.

## Known follow-ups

- `forgotPassword` is a stub — it always returns the same generic
  message (correct behavior to avoid leaking which emails are
  registered) but doesn't actually send an email yet; wire up a
  provider (SES, Postmark, etc.) and a signed reset-token flow.
- The arbitrage engine's monitoring intervals are in-process
  (`setInterval` per active trade). Fine for a single-instance demo;
  horizontally scaling the backend would need to move this to a job
  queue (BullMQ/Redis) so only one worker ticks a given trade.
- No automated test suite yet (unit tests for `walletLedger.service.ts`
  in particular would be high-value, given it's the financial safety
  core).
