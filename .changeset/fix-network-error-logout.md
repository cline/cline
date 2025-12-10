---
"claude-dev": patch
---

Fixed an issue where users were being logged out when opening the extension with network issues (e.g., opening laptop while offline). Now the extension retains your login state and will retry authentication when you make a request.
