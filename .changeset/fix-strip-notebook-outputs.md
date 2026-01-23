---
"claude-dev": patch
---

fix(extract-text): strip notebook outputs to reduce context size

Strip notebook cell outputs when extracting text content from Jupyter notebooks, significantly reducing the amount of context sent to the LLM while preserving the essential code and markdown content.
