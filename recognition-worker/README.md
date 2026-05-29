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

Then configure the extension:

```bash
export AI_HYDRO_RECOGNITION_API_BASE_URL="https://aihydro-recognition.aihydro-mgalib.workers.dev/v1"
```

When a custom domain is ready, use:

```bash
export AI_HYDRO_RECOGNITION_API_BASE_URL="https://recognition.ai-hydro.org/v1"
```
