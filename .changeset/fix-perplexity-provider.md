---
"claude-dev": minor
---

Pivot the Perplexity provider to Perplexity's Agent API (`api.perplexity.ai/v1`), exposing a multi-provider model catalogue (OpenAI GPT-5.x, Anthropic Claude, Google Gemini, xAI Grok, NVIDIA Nemotron, and Perplexity Sonar) behind a single API key — mirroring the OpenRouter "pick your underlying model" UX. Default model is now `openai/gpt-5.5`.
