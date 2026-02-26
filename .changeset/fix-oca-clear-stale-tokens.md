---
"cline": patch
---

fix: clear all OCA secrets on auth refresh failure to prevent re-auth loop

When OCA (Oracle Code Assist) token refresh fails with 400 invalid_grant or 401,
the stale secrets were not fully cleared from storage. The `clearAuth()` method
only cleared `ocaApiKey` and `ocaRefreshToken`, leaving legacy secrets
`ocaAccessToken` and `ocaTokenSet` (set by older Cline versions) in VS Code's
secret storage. These stale secrets caused every subsequent re-auth attempt to
fail in a loop, requiring manual SQLite deletion to recover.

Fix:
- Added `ocaAccessToken` and `ocaTokenSet` to `SecretKeys` in `state-keys.ts`
- Updated `OcaAuthProvider.clearAuth()` to clear all 4 OCA secrets

Fixes #9567
