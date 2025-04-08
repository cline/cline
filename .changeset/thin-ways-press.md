---
"claude-dev": patch
---

Replace Anthropic Bedrock SDK with native AWS Bedrock Runtime SDK

This change removes the dependency on @anthropic-ai/bedrock-sdk and uses the AWS SDK (@aws-sdk/client-bedrock-runtime) directly for all Anthropic model calls through Bedrock. This aligns with how other models like DeepSeek and Nova are already implemented, providing a more consistent approach across all Bedrock models and reducing external dependencies.

The implementation maintains all existing functionality including:
- Streaming responses
- Token usage tracking
- Reasoning/thinking capabilities
- Image handling
- Error handling

This change removes the dependency on @anthropic-ai/bedrock-sdk and uses the AWS SDK (@aws-sdk/client-bedrock-runtime) directly for all Anthropic model calls through Bedrock. This aligns with how other models like DeepSeek and Nova are already implemented, providing a more consistent approach across all Bedrock models and reducing external dependencies.

The implementation maintains all existing functionality including:
- Streaming responses
- Token usage tracking
- Reasoning/thinking capabilities
- Image handling
- Error handling
