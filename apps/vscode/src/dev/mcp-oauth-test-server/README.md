# MCP OAuth Test Server

A self-contained, **zero-dependency** (Node `http` only) server for exercising
and debugging Cline's MCP OAuth flow locally.

It plays both roles that a real remote MCP server + its OAuth provider play:

1. **OAuth 2.0 Authorization Server** (RFC 8414 / RFC 7591 DCR / RFC 7636 PKCE):
   - `GET /.well-known/oauth-protected-resource`
   - `GET /.well-known/oauth-authorization-server`
   - `POST /register` — Dynamic Client Registration
   - `GET /authorize` — interactive **Approve / Deny** consent page
   - `POST /token` — `authorization_code` + `refresh_token` grants
2. **MCP StreamableHTTP resource server**:
   - `POST /mcp` — returns `401 + WWW-Authenticate: Bearer resource_metadata="..."`
     until authenticated (this is what triggers Cline's OAuth flow), then a
     minimal `initialize` response.

The endpoint shapes match what `@modelcontextprotocol/sdk` v1.25.x discovers.

## Why

Exercises MCP OAuth failure modes without a real remote server:

- **State expiry** — Cline's `McpOAuthManager` enforces a state lifetime
  (`MCP_OAUTH_STATE_EXPIRY_MS`). If the callback returns after the window, it's
  rejected. Use `--slow-authorize` to push past it.
- **Denial** — the consent page's Deny button (or `--auto-deny`) redirects back
  with `error=access_denied`, so you can observe how Cline handles a denial.

## Run interactively

```bash
cd apps/vscode
npm run dev:mcp-oauth-test-server -- --verbose
# or directly:
npx tsx src/dev/mcp-oauth-test-server/server.ts --verbose
```

Then in Cline, add an MCP server (StreamableHTTP) pointing at:

```
http://127.0.0.1:7777/mcp
```

Click **Authenticate**. A browser opens the `/authorize` consent page where you
can click **Approve** or **Deny**.

## Options

| Flag | Description |
|------|-------------|
| `--port <n>` | Port to listen on (default `7777`, env `MCP_OAUTH_TEST_PORT`). `0` = OS-assigned random port. |
| `--random-port` | Bind an OS-assigned random free port instead of `--port` |
| `--instances <n>` | Start N independent servers, each on its own random port (implies `--random-port`). Use to add several MCP servers to Cline at once. |
| `--auto-approve` | Skip consent; always approve |
| `--auto-deny` | Skip consent; always deny (simulate "Deny" click) |
| `--code-ttl <ms>` | Authorization-code lifetime (default `600000`). Set small to force expiry. |
| `--slow-authorize <ms>` | Delay `/authorize` response (simulate a slow user) |
| `--verbose`, `-v` | Log every request |
| `--help`, `-h` | Show help |

## Adding multiple servers at once

Each instance binds its own random port and prints its `/mcp` endpoint. Add
each one to Cline as a separate StreamableHTTP server to exercise concurrent
OAuth flows / multiple authenticated servers:

```bash
npx tsx src/dev/mcp-oauth-test-server/server.ts --instances 3 --verbose
```

Because OAuth state is keyed by **server name** in `cline_mcp_settings.json`,
each Cline server entry gets its own independent tokens — even if two point at
the same URL.

## Reproducing specific bugs

**"OAuth state expired" race** — make the user take longer than Cline's
10-minute state window:

```bash
npx tsx src/dev/mcp-oauth-test-server/server.ts --slow-authorize 605000 --verbose
```

**Denied redirect** — always deny so every redirect carries `access_denied`:

```bash
npx tsx src/dev/mcp-oauth-test-server/server.ts --auto-deny --verbose
```

## Debug-harness integration

The server can be driven from the debug harness without a real browser:

- `TestServer`, `TestServerOptions`, and `parseArgs` are exported, so the
  harness can `import` and start an instance in-process (the module only
  auto-starts when run as the main script).
- Under `CLINE_CAPTURE_BROWSER=1` (see `src/utils/env.ts`), the authorization URL
  Cline tries to open is captured instead of launched. The harness `curl`s the
  captured `/authorize` URL (append `decision=approve` or `decision=deny` to
  skip the consent page) to get the `vscode://` callback, then delivers it to the
  extension via `globalThis.__clineHandleUri(...)` (see the debug harness README,
  "Testing MCP OAuth").

## Manual flow (no browser, for scripting)

```bash
PORT=7777
# 1. Discover
curl -s localhost:$PORT/.well-known/oauth-authorization-server
# 2. Register a client
CID=$(curl -s -X POST localhost:$PORT/register -H 'Content-Type: application/json' \
  -d '{"redirect_uris":["http://127.0.0.1:48801/cb"]}' \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).client_id))")
# 3. Approve and capture the code from the redirect Location header
#    (append &decision=approve to skip the HTML page)
```
