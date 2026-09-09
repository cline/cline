---
"@cline/llms": patch
---

Fix Bedrock requests failing when reasoning effort is set for models without reasoning support. Portable top-level reasoning is now suppressed for Bedrock catalog models whose capabilities lack `reasoning` (e.g. Llama, Nova Pro/Lite/Micro), effort levels are clamped to each Bedrock model's advertised values (e.g. GPT-OSS `low`/`medium`/`high`), and reasoning normalization strips intent for known non-reasoning models instead of forwarding it to an API that rejects it.
