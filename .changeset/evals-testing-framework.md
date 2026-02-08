---
"claude-dev": patch
---

Add comprehensive LLM evaluation framework with CI integration

- Smoke tests: 7 curated scenarios testing tools across providers (Claude, GPT-5, Gemini)
- Analysis framework: pass@k metrics for measuring reliability
- CI workflow: Parallel smoke tests on PRs with ~3min execution time
- E2E runner: cline-bench integration for real-world task evaluation (local only for now)
