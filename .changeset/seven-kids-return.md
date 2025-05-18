---
"roo-cline": minor
---

Adds refresh models button for Unbound provider
Adds a button above model picker to refresh models based on the current API Key.

1. Clicking the refresh button saves the API Key and calls /models endpoint using that.
2. Gets the new models and updates the current model if it is invalid for the given API Key.
3. The refresh button also flushes existing Unbound models and refetches them.
