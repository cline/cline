---
"claude-dev": patch
---

Fixes a search and replace edge case bug where Cline would previously delete the whole file
Making the search and replace algorithm more lenient to support models that prefer to use the <<<<<< and >>>>> format instead of ----- and +++++
