---
"claude-dev": patch
---

Improve Requesty provider integration

- Adding Cline headers to API requests, to enable targeted optimizations
- Read o3 reasoning effort from Cline config, not model name
- Show token information in task header
- Get total cost from response when available
