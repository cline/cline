# Cline SDK — Provider Credentials & OAuth Reference

This document describes how the Cline SDK publishes inference provider metadata, handles credential resolution, and orchestrates OAuth authentication flows. It is intended for client developers integrating with `@clinebot/llms` and `@clinebot/core`.

---

## Provider Catalog

The SDK owns the canonical list of inference providers. It is **not** produced by clients.

### Where Providers Are Defined

| Layer | Location | What It Owns |
|---|---|---|
| `@clinebot/llms` | `packages/llms/src/gateway/builtins.ts` | `BUILTIN_SPECS` array — every built-in provider's `id`, `name`, `description`, `family`, `capabilities`, `apiKeyEnv`, `defaultModelId`, default `baseUrl` |
| `@clinebot/llms` | `packages/llms/src/provider/ids.ts` | `BUILT_IN_PROVIDER` enum and `BUILT_IN_PROVIDER_IDS` array |
| `@clinebot/shared` | `packages/shared/src/llms/gateway.ts` | `GatewayProviderManifest` type — the runtime shape clients receive |
| `@clinebot/llms` | `packages/llms/src/gateway/provider-keys.ts` | Mapping from external `modelsDevKey` identifiers to runtime/generated provider IDs |

### BuiltinSpec Shape

Each built-in provider is declared as a `BuiltinSpec`:

```typescript
interface BuiltinSpec {
  id: string;                          // e.g. "anthropic", "openai-native", "cline"
  name: string;                        // Human-readable name
  description: string;
  family: ProviderFamily;              // Protocol family: "openai-compatible", "anthropic", "google", etc.
  protocol?: ProviderProtocol;
  client?: ProviderClient;
  capabilities?: ProviderCapability[]; // "reasoning" | "prompt-cache" | "tools" | "oauth" | "temperature" | "files"
  modelsProviderId?: string;
  defaultModelId?: string;
  modelsFactory?: () => Record<string, ModelInfo>;
  env?: readonly ("browser" | "node")[];
  apiKeyEnv?: readonly string[];       // Environment variable names for API key resolution
  docsUrl?: string;
  defaults?: GatewayProviderSettings;  // Includes default baseUrl
}
```

### GatewayProviderManifest (Runtime Shape)

`toManifest()` converts a `BuiltinSpec` into a `GatewayProviderManifest`, which is what clients interact with at runtime:

```typescript
interface GatewayProviderManifest {
  id: string;
  name: string;
  description?: string;
  defaultModelId: string;
  models: readonly GatewayModelDefinition[];
  env?: readonly ("browser" | "node")[];
  api?: string;             // Default base URL
  apiKeyEnv?: readonly string[];  // Env var names for credential resolution
  docsUrl?: string;
  metadata?: Record<string, JsonValue | undefined>;
}
```

---

## Credential Resolution

### API Key Resolution Order

The SDK resolves credentials in `packages/llms/src/gateway/http.ts` via `resolveApiKey()`:

1. **Explicit `apiKey`** — passed directly in provider config
2. **`apiKeyResolver()`** — async callback (e.g. fetch from keychain)
3. **`apiKeyEnv`** — iterate environment variable names from the provider manifest; first non-empty value wins

If all fail, `getMissingApiKeyError()` produces a message naming the expected env vars:
> `Missing API key for provider "anthropic". Set apiKey explicitly or one of: ANTHROPIC_API_KEY.`

### Per-Provider Credential Metadata Examples

| Provider | `apiKeyEnv` |
|---|---|
| `anthropic` | `["ANTHROPIC_API_KEY"]` |
| `openai-native` | `["OPENAI_API_KEY"]` |
| `gemini` | `["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"]` |
| `vertex` | `["GCP_PROJECT_ID", "GOOGLE_CLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS", "GEMINI_API_KEY", "GOOGLE_API_KEY"]` |
| `bedrock` | `["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]` |
| `sapaicore` | `["AICORE_SERVICE_KEY", "VCAP_SERVICES"]` |
| `cline` | `["CLINE_API_KEY"]` |
| `openrouter` | `["OPENROUTER_API_KEY"]` |
| `deepseek` | `["DEEPSEEK_API_KEY"]` |

Most OpenAI-compatible providers follow the pattern `["{PROVIDER}_API_KEY"]`.

### Provider-Specific Settings

Some providers need additional configuration beyond an API key:

- **Vertex/GCP**: `gcpProjectId`, `gcpRegion`
- **Bedrock/AWS**: `awsAuthentication` (`"iam" | "api-key" | "profile"`), `awsRegion`, `awsAccessKey`, `awsSecretKey`, `awsSessionToken`, `awsProfile`

These are passed through `ProviderSelectionConfig.settings` rather than `apiKeyEnv`.

---

## OAuth Authentication

### Which Providers Support OAuth

Only providers with `"oauth"` in their `capabilities` array support OAuth:

| Provider | OAuth Implementation |
|---|---|
| `cline` | `packages/core/src/auth/cline.ts` — Cline API OAuth |
| `openai-codex` | `packages/core/src/auth/codex.ts` — ChatGPT/OpenAI Codex OAuth with PKCE |
| `oca` | `packages/core/src/auth/oca.ts` — Oracle Code Assist OAuth with PKCE |

The CLI confirms this in `apps/cli/src/commands/auth.ts`:
```typescript
// Only these three providers support CLI OAuth flow
if (providerId === "cline") return oauthApi.loginClineOAuth(...)
if (providerId === "oca") return oauthApi.loginOcaOAuth(...)
if (providerId === "openai-codex") return oauthApi.loginOpenAICodex(...)
throw new Error(`Provider "${providerId}" does not support CLI OAuth flow`)
```

### Responsibility Split: SDK vs Client

| Concern | Owner | Details |
|---|---|---|
| Spawn local callback server | **SDK** | `startLocalOAuthServer()` in `packages/core/src/auth/server.ts` |
| Build authorization URL | **SDK** | Each auth module constructs the URL with redirect_uri, state, etc. |
| Open browser / present URL | **Client** | SDK calls `callbacks.onAuth({ url, instructions })` — client decides how to handle |
| Collect redirect code | **SDK** | Local HTTP server parses `?code=&state=` from redirect |
| Exchange code for tokens | **SDK** | Each auth module handles the token exchange |
| Prompt for manual code input | **Client** | SDK calls `callbacks.onPrompt()` or `callbacks.onManualCodeInput()` as fallback |

### The SDK Does NOT Open Browsers

The SDK never calls `open()` or launches a browser. It uses a callback-based interface:

```typescript
// packages/core/src/auth/types.ts
interface OAuthLoginCallbacks {
  onAuth: (info: { url: string; instructions?: string }) => void;  // SDK emits URL here
  onPrompt: (prompt: OAuthPrompt) => Promise<string>;              // SDK asks for input here
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;                       // Fallback if redirect fails
}
```

### The SDK DOES Spawn the Local Callback Server

`packages/core/src/auth/server.ts` exports `startLocalOAuthServer()`:

- Creates a `node:http` server on `127.0.0.1`
- Tries a list of candidate ports in order, skipping `EADDRINUSE`
- Listens on a configured callback path (e.g. `/callback`)
- Extracts `code`, `state`, `provider`, `error` from the redirect URL query params
- Returns a success HTML page to the browser ("Authentication Successful — You can close this window")
- Auto-closes after 3 seconds via embedded `<script>`
- Times out after 5 minutes by default

```typescript
interface LocalOAuthServer {
  callbackUrl: string;                                    // e.g. "http://127.0.0.1:54321/callback"
  waitForCallback: () => Promise<OAuthCallbackPayload>;   // Resolves when redirect arrives
  cancelWait: () => void;
  close: () => void;
}
```

### OAuth Redirect URLs Are NOT in Provider Metadata

Redirect/callback URLs are **dynamically constructed at runtime**, not published in the provider manifest:

- **Cline**: Dynamic port → `http://localhost:{port}/callback`
- **OpenAI Codex**: Hardcoded `http://localhost:1455/auth/callback` (fixed port, fixed client ID `app_EMoamEEZ73f0CkXaXp7hrann`)
- **OCA**: Dynamic port with configurable path, default `/oauth/callback`

### Client Integration Helper

`packages/core/src/auth/client.ts` provides a convenience adapter:

```typescript
interface OAuthClientCallbacksOptions {
  onPrompt: (prompt: OAuthPrompt) => Promise<string>;
  onOutput?: (message: string) => void;
  openUrl?: (url: string) => void | Promise<void>;  // Client provides browser-open function
  onOpenUrlError?: (context: { url: string; error: unknown }) => void;
}

function createOAuthClientCallbacks(options): OAuthLoginCallbacks
```

The `openUrl` field is where a CLI passes its `open` implementation, a Tauri app passes shell open, etc.

### End-to-End OAuth Flow

```
1. Client calls SDK login function (e.g. loginClineOAuth)
2. SDK → startLocalOAuthServer() → binds to 127.0.0.1:{port}
3. SDK → builds authorization URL with redirect_uri = callback server URL
4. SDK → callbacks.onAuth({ url, instructions })
5. Client → opens browser (or displays URL to user)
6. User → authenticates in browser
7. Provider → redirects to http://127.0.0.1:{port}/callback?code=...&state=...
8. SDK's local server → captures code and state, renders success page
9. SDK → exchanges authorization code for tokens (provider-specific)
10. SDK → returns OAuthCredentials { access, refresh, expires, accountId?, email? }
```

If the local server redirect times out or fails, the SDK falls back to:
- `onManualCodeInput()` — ask user to paste code
- `onPrompt({ message: "Paste the authorization code (or full redirect URL):" })` — final fallback
- `parseAuthorizationInput()` can handle both raw codes and full URLs with query params

### OAuthCredentials Shape

```typescript
interface OAuthCredentials {
  access: string;       // Access token
  refresh: string;      // Refresh token
  expires: number;      // Expiration timestamp (ms since epoch)
  accountId?: string;   // Provider-specific account ID
  email?: string;       // For display/telemetry
  metadata?: Record<string, unknown>;
}
```

### Provider-Specific OAuth Details

**Cline OAuth** (`packages/core/src/auth/cline.ts`):
- Authorization URL: `{apiBaseUrl}/auth/authorize?client_type=extension&callback_url=...&state=...`
- Token endpoint: `{apiBaseUrl}/auth/token`
- Default API base: `https://api.cline.bot`
- Supports provider passthrough (callback can include `?provider=google` etc.)

**OpenAI Codex OAuth** (`packages/core/src/auth/codex.ts`):
- Uses PKCE (code challenge + verifier)
- Authorization: `https://auth.openai.com/oauth/authorize`
- Token: `https://auth.openai.com/oauth/token`
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann`
- Fixed redirect: `http://localhost:1455/auth/callback`
- Scopes: `openid profile email offline_access`
- JWT claim path: `https://api.openai.com/auth`

**OCA OAuth** (`packages/core/src/auth/oca.ts`):
- Uses PKCE (S256 code challenge)
- Supports `internal` and `external` mode with separate IDCS URLs and client IDs
- Authorization: `{idcsUrl}/oauth2/v1/authorize`
- Token: `{idcsUrl}/oauth2/v1/token`
- Configurable callback ports and path
