# AI-Hydro Recognition Worker

Zero-money-tier recognition API for AI-Hydro marketplaces using Cloudflare
Workers + D1.

The worker records anonymous marketplace usage events and serves aggregate item
counts. It does not store raw file paths, user names, prompts, maps, or IP
addresses in the database.

## Endpoints

```text
GET  /v1/health
POST /v1/events
POST /v1/stars
GET  /v1/counts?marketplace=gallery
```

Event payload:

```json
{
  "marketplace": "gallery",
  "itemId": "wabash-nldi-basin-03335500",
  "eventType": "import",
  "clientIdHash": "sha256...",
  "aiHydroVersion": "0.2.2",
  "itemType": "dataset_connector",
  "itemVersion": "0.1.0",
  "source": "ui"
}
```

Star payload:

```json
{
  "marketplace": "gallery",
  "itemId": "wabash-nldi-basin-03335500",
  "starred": true,
  "clientIdHash": "sha256..."
}
```

## Deploy

```bash
cd recognition-worker
npm install
npx wrangler d1 create aihydro_recognition
# copy the generated database_id into wrangler.toml
npx wrangler d1 execute aihydro_recognition --file=./schema.sql --remote
npx wrangler deploy
```

If Wrangler reports that `@cloudflare/workerd-darwin-arm64` is missing on
Apple Silicon, repair the local optional dependency install with:

```bash
npm i -D @cloudflare/workerd-darwin-arm64@1.20260526.1
```

## Abuse controls

`/v1/events` and `/v1/stars` are anonymous and unauthenticated by design (no
user accounts). Two server-side controls bound casual/accidental inflation —
neither claims to stop a determined attacker who varies IP + User-Agent per
request:

- **Daily dedup** (`daily_dedup` table): a server-derived key
  (`sha256(CF-Connecting-IP | User-Agent | UTC day)`, never stored in raw
  form) caps one counted event per (marketplace, item_id, event_type) per
  (IP, UA) pair per day. The client-supplied `clientIdHash` is not trusted for
  this — it's client-chosen and trivially rotated.
- **Retention**: a daily cron (`scheduled()` in `src/index.ts`, `[triggers]`
  in `wrangler.toml`) prunes `events` rows older than 90 days. `item_counts`
  (the durable aggregate the marketplace UI reads) is never pruned.

**Not yet configured — requires a manual dashboard/API step**: Cloudflare
Rate Limiting on `/v1/events` and `/v1/stars`, per source IP. This provisions
a rule against the live zone/route and is treated as a deliberate
infrastructure change, not something to script unattended. To add it:

```bash
# Dashboard: Security > WAF > Rate limiting rules, or:
npx wrangler ratelimit create aihydro-recognition-writes --requests 30 --period 60
# then reference the resulting namespace as a binding in wrangler.toml and
# check it at the top of recordEvent()/setStar() in src/index.ts.
```

Then configure the extension:

```bash
export AI_HYDRO_RECOGNITION_API_BASE_URL="https://aihydro-recognition.aihydro-mgalib.workers.dev/v1"
```

When a custom domain is ready, use:

```bash
export AI_HYDRO_RECOGNITION_API_BASE_URL="https://recognition.ai-hydro.org/v1"
```
