---
"claude-dev": minor
---

Add Cerebras as a new API provider with comprehensive model support. Features include:

- **5 Cerebras models**: llama3.1-8b, llama-4-scout-17b-16e-instruct, llama-3.3-70b, qwen-3-32b, and deepseek-r1-distill-llama-70b
- **Native Cerebras SDK integration** using @cerebras/cerebras_cloud_sdk
- **Reasoning support** for Qwen and DeepSeek R1 Distill models with `<think>` tag handling
- **Streaming responses** with proper error handling and usage tracking
- **Cost calculation** and token counting
- **UI integration** with API key configuration and model selection
- **Free pricing** for all models (set to $0 input/output costs)

Users can now connect to Cerebras's high-performance inference API using their API key and access fast, efficient LLM services directly from within Cline. 