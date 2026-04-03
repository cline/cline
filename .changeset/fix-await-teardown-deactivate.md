---
"@fake-scope/fake-pkg": patch
---

fix: await tearDown() in deactivate() to prevent slow extension host shutdown

The `deactivate()` function was calling `tearDown()` without `await`, causing VS Code's extension host to race against async cleanup (webview disposal, hook process termination). This resulted in slow "Stopping Extension Hosts" dialogs and could cause tasks to auto-restart on reload, burning API credits.
