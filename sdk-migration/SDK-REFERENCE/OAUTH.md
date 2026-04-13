# Cline SDK — Provider Credentials & OAuth Reference

How the SDK publishes provider metadata, handles credential resolution,
and orchestrates OAuth flows. For the migration plan, see [../README.md](../README.md).

## Provider Catalog

The SDK owns the canonical list of inference providers via `BUILTIN_SPECS`
in `@clinebot/llms`. Each provider is a `BuiltinSpec` with `id`, `name`,
`family`, `capabilities`, `apiKeyEnv`, `defaultModelId`, etc.

At runtime, `toManifest()` converts these to `GatewayProviderManifest`
objects that clients receive.

## Credential Resolution

Order: explicit `apiKey` → `apiKeyResolver()` → `apiKeyEnv` env vars.

If all fail, `getMissingApiKeyError()` produces a message naming the
expected env vars (e.g., `ANTHROPIC_API_KEY`).

## OAuth Authentication

### Providers Supporting OAuth

| Provider | Implementation |
|----------|---------------|
| `cline` | `packages/core/src/auth/cline.ts` |
| `openai-codex` | `packages/core/src/auth/codex.ts` (PKCE) |
| `oca` | `packages/core/src/auth/oca.ts` (PKCE) |

### Responsibility Split

| Concern | Owner |
|---------|-------|
| Spawn local callback server | **SDK** (`startLocalOAuthServer()`) |
| Build authorization URL | **SDK** |
| Open browser / present URL | **Client** (via `callbacks.onAuth()`) |
| Collect redirect code | **SDK** (local HTTP server) |
| Exchange code for tokens | **SDK** |
| Persist tokens | **Client** (adapter layer) |

### The SDK Does NOT Open Browsers

Uses callback-based interface:
```typescript
interface OAuthLoginCallbacks {
  onAuth: (info: { url: string; instructions?: string }) => void
  onPrompt: (prompt: OAuthPrompt) => Promise<string>
  onProgress?: (message: string) => void
  onManualCodeInput?: () => Promise<string>
}
```

### Client Integration Helper

```typescript
import { createOAuthClientCallbacks } from "@clinebot/core"

const callbacks = createOAuthClientCallbacks({
  onPrompt: ...,
  openUrl: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
})
```

### End-to-End Flow

```
1. Client calls SDK login function (e.g. loginClineOAuth)
2. SDK → startLocalOAuthServer() → binds to 127.0.0.1:{port}
3. SDK → builds authorization URL with redirect_uri = callback URL
4. SDK → callbacks.onAuth({ url, instructions })
5. Client → opens browser
6. User → authenticates in browser
7. Provider → redirects to callback URL with code
8. SDK → captures code, exchanges for tokens
9. SDK → returns OAuthCredentials { access, refresh, expires, accountId?, email? }
10. Client → persists tokens to secrets.json
```

### Provider-Specific Details

**Cline OAuth:**
- Authorization: `{apiBaseUrl}/auth/authorize?client_type=extension&callback_url=...`
- Token: `{apiBaseUrl}/auth/token`
- Default API base: `https://api.cline.bot`
- **Always use `{apiBaseUrl}`, never hardcode**

**OpenAI Codex OAuth:**
- Uses PKCE
- Fixed redirect: `http://localhost:1455/auth/callback`
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann`

**OCA OAuth:**
- Uses PKCE (S256)
- Supports `internal` and `external` modes

### Pitfalls From Previous Attempts

1. **`workos:` prefix**: Account IDs from the SDK may or may not have
   a `workos:` prefix. The webview expects a specific format. Use
   explicit conversion with tests.

2. **`{appBaseUrl}` vs hardcoded URLs**: Always use the environment
   variable. Hardcoding `app.cline.bot` breaks the local/staging/
   production switcher.

3. **Race condition on subscribe**: The webview may subscribe to
   `subscribeToAuthStatusUpdate` before the bridge pushes initial
   state. Always push initial state on subscribe.

4. **Token field names**: The SDK's `OAuthCredentials` uses `access`
   and `refresh`, but classic storage may use different field names.
   Map explicitly, don't rely on shape compatibility.