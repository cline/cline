# Gotchas (compact rubric)

Jump to the failing § only.

1. **Shape mismatch** — wrong Mermaid type for the content.
2. **Hairball** — >20 nodes or 3+ subgraph levels; split by zoom.
3. **Verb edges** — label contracts/types, not "sends/calls".
4. **Happy-path-only sequence** — add `alt` failure or caption scope-out.
5. **Identity drift** — one canonical name; check `.claude/diagram-conventions.md`.
6. **Prose duplication** — caption must not narrate arrows.
7. **Fake precision** — no invented gantt dates / vibe percentages.
8. **Direction fighting content** — LR for flow, TD for hierarchy.
9. **Diagrammed list** — if no graph structure, write a list.
10. **Theme-breaking style** — prefer `stroke-dasharray` over hardcoded colors.
11. **Stale structure** — ground-truth schemas/code before drawing; caption provenance.
12. **Unvalidated ship** — run `bun sdk/scripts/validate-mermaid.ts` before claiming done.
