---
"claude-dev": patch
---

invoke message removed as part of protobus migratiuon, deemed unnecesary as webview messages can be handled by askResponse, and ClineAPI usage can be handled through the extension without grpc. Also added tests for ClineAPI.
