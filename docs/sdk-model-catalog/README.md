# SDK-backed Model Catalog

Working documents for the migration of the model catalog and provider settings onto SDK abstractions.

Read in this order:

1. **[design.md](./design.md)** — *Why*. Findings, current state, proposed architecture, pre-mortem.
2. **[architecture.md](./architecture.md)** — *What shape*. The two abstractions (`ProviderConfigStore`, `ProviderCatalog`), invariants, dependency graph, structural impossibilities, scenario walkthroughs.
3. **[implementation-plan.md](./implementation-plan.md)** — *What to do*. Twelve phases, twelve checkpoints, exit criteria, offramps.
4. **[agent-guidance.md](./agent-guidance.md)** — *How to steer agents*. Succinct prompting and per-model observations from teammate experiments.
5. **[context-window-display-fix-plan.md](./context-window-display-fix-plan.md)** — *Targeted fix*. Plan for repairing the chat status bar's incorrect context window for migrated providers and the (provider, modelId) tearing on switch/commit. Four host-then-webview steps.

The contracts these docs describe live at [`src/sdk/model-catalog/contracts.ts`](../../src/sdk/model-catalog/contracts.ts).
