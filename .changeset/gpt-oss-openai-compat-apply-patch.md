---
"claude-dev": patch
---

Fix OpenAI-compatible `gpt-oss` native tool mode so file editing works reliably:

- Enable `apply_patch` for `gpt-oss` models when using native GPT-5 prompt variants.
- Add regression tests covering model family selection and tool availability.
- Add a smoke-test scenario for OpenAI-compatible `gpt-oss` file editing and improve the smoke runner for per-scenario auth/env requirements.
