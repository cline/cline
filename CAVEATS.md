# SDK Migration Caveats & Known Issues

Tracking issues found during the migration from the pre-SDK inference system to the ClineCore SDK.

## Status Legend
- 🔴 **Blocker** — prevents core functionality
- 🟡 **Minor** — cosmetic or UX annoyance
- 🟢 **Fixed** — resolved

NOTE:

1. Use your debugging tool (DEBUG-HARNESS.md) to reproduce issues.
2. Use your debugging tool to validate your fixes.
3. Commit one verified change together.
4. Work on these in any order you prefer.

---

🟢 Under accounts, the when logged in the "current balance" is ---- and
the reload button does nothing. **Fixed:** getUserCredits handler fetches
balance from Cline API using stored auth token.

🟢 Under accounts, the "cline environment" dropdown doesn't change from
production when you select "staging" or "local". **Fixed:** state-builder
now reads `clineEnv` from globalState and maps to Environment enum;
updateSettings handler persists clineEnv and clears auth on change.

🟢 Under accounts, the logout button does nothing. **Fixed:**
accountLogoutClicked handler clears auth credentials from disk.

🟢 Reportedly under accounts you can't sign in. **Fixed:**
accountLoginClicked handler (was STUB) now opens the Cline login page
in the browser.

🔴 When you have a low credit balance, even after you change accounts
(for example from one "org" to another) or refreshing you keep getting
an error "Insufficient balance. Your Cline Credits balance ..."

🔴 In chat, a chat response has a "copy" button that is
obscured/partially obscured by the last generated code block. In the
classic extension, this appears with enough space around it to be
visible.

🟢 Changing the model during a conversation does not, *apparently*,
change the model used for inference. **Fixed:** updateSettings now
updates the in-memory apiConfiguration (not just disk) so
model/provider changes take effect immediately for subsequent sessions.

🔴 The OpenAI compatible provider produces "404 404 page not found"
errors.

🔴 When running tools (for example, prompt the agent to use kb_status)
output rectangles appear but they are blank.

🔴 When prompted with multiple-step work (like 1. Do this 2. Do that)
the chat displays "0/0 TODOs".

🟡 Checkpoints appear in options, but checkpoints don't appear in
chats; we need to overhaul the checkpoints system anyway see
ARCHITECTURE.md.

🟢 In the history section, you can't mark chats as favorites.

🟡 Banners (for example "Try Claude Sonnet 4.6") can be dismissed, but
there are no < and > buttons visible to page between them.

🟢 "Add to Cline" right click menu (use the command to trigger it)
does not do anything. **Fixed:** sendAddToInputEvent now falls back to
the SDK bridge's pushAddToInput when no classic gRPC subscriptions are
active; WebviewGrpcBridge handles subscribeToAddToInput streaming and
sends via both gRPC response and typed message.

🟢 When a task is cancelled, you can't enter a new chat and send that
chat in addition. (The repro is: Run a task, click cancel relatively
quickly, type a new prompt, try to hit enter/click the arrow.) **Fixed:**
cancelTask now clears currentSession after abort so subsequent
askResponse calls start a new task instead of sending to the aborted
session.

🟢 MCP Servers tab never finishes loading (may be a workos: token
prefix problem?) **Fixed:** subscribeToMcpServers now sends initial
server data as a typed message (mcpServers) instead of only via gRPC
streaming response, which the webview's dual-listen pattern picks up.

🟢 Attached images (via drag and drop or the + icon to attach an image
file) aren't submitted to models. **Fixed:** newTask and askResponse
now include the images array in ClineMessage objects so attached images
appear in the chat UI and are passed to the SDK session.

🔴 Changing the account profile in the accounts tab (for example from
Cline External, which has budget, to Cline Internal Testing Org, which
doesn't) doesn't switch to that profile for inference.

🟡 Account panel may show logged-out state on launch despite being
logged in. Inference still works. The `subscribeToAuthStatusUpdate`
streaming subscription in the webview may not be established before
the bridge pushes initial auth data, causing a race condition. On most
launches the auth state loads correctly (verified via debug harness),
but the user reports intermittent occurrences.

🔴 "Sign up with Cline" button does not do the IDE login flow — it
opens the dashboard (`https://app.cline.bot/login`) instead. In
origin/main, `accountLoginClicked` calls
`AuthService.createAuthRequest()` which starts a local HTTP server for
the OAuth callback, calls the Cline API auth endpoint with the
callback URL, and opens the resulting OAuth redirect URL. The SDK does
not have access to `AuthService` or `HostProvider.getCallbackUrl()`,
so it falls back to opening the dashboard URL directly. Users who are
not logged in cannot authenticate through the extension UI.
**Requires:** SDK support for OAuth callback flows (see
SDK-FEATURE-REQUESTS.md).

🔴 Buttons in the MCP Servers popup do nothing. The restart (🔄),
enable/disable toggle, and delete (🔴) buttons on individual MCP
servers are all no-ops. The gRPC handler stubs these methods:
`restartMcpServer`, `deleteMcpServer`, `toggleMcpServer`,
`toggleToolAutoApprove`, `authenticateMcpServer`, `updateMcpTimeout`.
In origin/main these go through `controller.mcpHub` which manages live
MCP server connections. The SDK reads MCP settings from disk but does
not expose server lifecycle management to the webview. See SDK-MCP.md
for details, we need to implement much more elaborate MCP support
client side to work with the SDK, via a custom RuntimeBuilder and tool
client factory that supports streamable HTTP; watches the file for
changes and either restarts a session or causes the tool definitions
to change; etc.

🔴 Buttons in the MCP Servers → Configure tab do nothing. Same root
cause as above — the configure tab shows servers (e.g. "linear",
"kamibiki") with restart/toggle/delete controls, but all interactions
are stubbed. The "Configure MCP Servers" and "Advanced MCP Settings"
links also depend on `openMcpSettings` which may or may not be wired.

🟡 MCP Marketplace never loads. The Marketplace tab shows "No MCP
servers found in the marketplace". **Partial fix applied:**
`subscribeToMcpMarketplaceCatalog` in `webview-grpc-bridge.ts` now
reads from the disk cache (`~/.cline/data/cache/mcp_marketplace_catalog.json`)
via `readMcpMarketplaceCatalogFromCache()` and pushes the catalog to
the webview as a streaming response. This works if the cache was
previously populated by the classic extension. However,
`refreshMcpMarketplace` (which fetches fresh data from the API) is
still stubbed because it requires an authenticated API call to
`https://api.cline.bot/v1/mcp/marketplace`. If no cache file exists
(fresh install), the marketplace will remain empty.
**Note:** Could not validate with debug harness since it runs the
classic extension, not the SDK adapter.
