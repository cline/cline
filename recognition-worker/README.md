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

## Deploy

```bash
cd recognition-worker
npm install
npx wrangler d1 create aihydro_recognition
# copy the generated database_id into wrangler.toml
npx wrangler d1 execute aihydro_recognition --file=./schema.sql --remote
npx wrangler deploy
```

Then configure the extension:

```bash
export AI_HYDRO_RECOGNITION_API_BASE_URL="https://<worker-subdomain>.workers.dev/v1"
```

When a custom domain is ready, use:

```bash
export AI_HYDRO_RECOGNITION_API_BASE_URL="https://recognition.ai-hydro.org/v1"
```
