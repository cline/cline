---
"cline": patch
---

fix: improve Jupyter notebook diff view and reduce LLM context for notebook edits

- Restore switchToSpecializedEditor() for Jupyter notebook diff views that was accidentally removed during rebase
- Open .ipynb files in Jupyter notebook editor after save instead of leaving stale diff view
- Strip notebook outputs from content sent to LLM, reducing context by 95% (196KB → 9KB)

