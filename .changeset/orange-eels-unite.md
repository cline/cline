---
"claude-dev": patch
---

Fix AWS Bedrock Profiles. When configuring the AnthropicBedrock Client you must pass AWS credentials in a specific way, otherwise the client will default to reading credentials from the default AWS profile.
