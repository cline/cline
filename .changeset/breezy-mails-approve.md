---
"claude-dev": patch
---

Fix AWS Bedrock credential caching issue with AWS Identity Manager

Fixed an issue where AWS Bedrock provider would cache credentials and not detect when AWS Identity Manager updated credential files externally. The provider now uses `ignoreCache: true` for profile-based authentication to ensure fresh credential reads, while maintaining performance with smart caching for manual credentials.
