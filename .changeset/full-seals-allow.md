---
"dev": patch
---

fix(cli): allow empty Ollama base URL to use default

Previously, configuring Ollama with an empty base URL (default localhost:11434)
would save successfully but the provider would not appear as ready. This was
caused by two issues:

1. The configuration update logic skipped saving empty base URLs for Ollama
2. The provider list check treated empty base URLs as invalid

For Ollama specifically, an empty base URL is valid and means "use the default
localhost:11434". This commit fixes both checks to properly handle this case.
