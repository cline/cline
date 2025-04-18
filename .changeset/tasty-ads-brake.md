---
"claude-dev": patch
---

Fixed issue where setting `AWS_PROFILE` environment variable in shell init scripts would cause the AWS SDK to ignore Cline settings.
