# AI-Hydro Marketplace Recognition

AI-Hydro uses two recognition layers for marketplace contributors.

## Layer 1: GitHub-native evidence

Each marketplace catalog can publish contributor and reputation files from
manifest metadata plus public GitHub signals:

- contributor names, GitHub handles, ORCID, affiliation, and roles;
- trust badges such as `Official`, `Reviewed`, and `Citation-ready`;
- GitHub repository stars and forks;
- GitHub release asset downloads when a `releaseAssetUrl` is provided;
- GitHub issue or pull-request reactions when a `discussionUrl` is provided.

This layer is public, auditable, and does not require any hosted database.

## Layer 2: AI-Hydro usage counts

AI-Hydro-native imports and installs are recorded through the optional
Recognition API. The initial implementation is a Cloudflare Workers + D1
service under `recognition-worker/`.

The extension records only minimal anonymous events:

```json
{
  "marketplace": "gallery",
  "itemId": "wabash-nldi-basin-03335500",
  "eventType": "import",
  "clientIdHash": "sha256 hash",
  "aiHydroVersion": "0.2.2",
  "itemType": "dataset_connector",
  "itemVersion": "0.1.0",
  "source": "ui"
}
```

It does not send prompts, file paths, map content, raw data, user names, or
workspace names.

AI-Hydro stars are stored separately from GitHub stars. They are native
in-app appreciation signals keyed by marketplace item and anonymous client
hash, so one AI-Hydro installation can star or unstar an item without inflating
the count through repeated clicks.

## Configuration

Production and staging default to the hosted AI-Hydro recognition worker:

```text
https://aihydro-recognition.aihydro-mgalib.workers.dev/v1
```

Override it with:

```bash
export AI_HYDRO_RECOGNITION_API_BASE_URL="https://recognition.ai-hydro.org/v1"
```

Environment-specific overrides:

- `AI_HYDRO_RECOGNITION_API_BASE_URL`
- `AI_HYDRO_RECOGNITION_API_BASE_URL_STAGING`
- `AI_HYDRO_RECOGNITION_API_BASE_URL_LOCAL`

Local development remains opt-in by default. When the URL is unset or the API is
unavailable, marketplace imports and installs continue normally and counts
simply do not update.

## Current event hooks

- Research Gallery import: `marketplace=gallery`, `eventType=import`
- Research Gallery map plate template open: `marketplace=gallery`, `eventType=template_open`
- Research Gallery AI-Hydro star/unstar: `POST /v1/stars`
- Skills marketplace install: `marketplace=skills`, `eventType=install`
- Modules marketplace install: `marketplace=modules`, `eventType=install`

MCP and Connectors should use the same `MarketplaceRecognitionService` when
their install/import paths are hardened.
