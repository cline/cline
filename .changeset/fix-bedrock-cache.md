---
"claude-dev": patch
---

fix(bedrock): Use ignoreCache for profile-based AWS credential loading

Ensures that AWS Bedrock provider always fetches fresh credentials when using IAM profiles by setting `ignoreCache: true` for `fromNodeProviderChain`. This resolves issues where externally updated credentials (e.g., by AWS Identity Manager) were not detected by Cline, requiring an extension restart. Manual credential handling remains unchanged.
