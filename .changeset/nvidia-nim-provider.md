---
"cline": minor
---

Add Nvidia NIM provider with support for all NIM models

Adds production-ready support for Nvidia NIM (NVIDIA Inference Microservices) as a new API provider. Features include:

- Universal model support: Works with ANY Nvidia NIM model, not just predefined ones
- 25 optimized models with accurate pricing and capabilities (Llama, Mistral, Nemotron, Phi, Gemma, Qwen, Granite, DeepSeek, and more)
- 5 vision models with multimodal support
- Full streaming support with token usage tracking
- Tool/function calling support
- Cost calculation and tracking
- Self-hosted NIM support via custom base URL
- Comprehensive error handling (401, 429, 404, 503)
- Smart three-tier model selection: predefined → cached → defaults

Users can now access new Nvidia models immediately without waiting for updates, while still getting optimized settings for popular models.
