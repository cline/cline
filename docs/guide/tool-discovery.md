---
description: How AI-Hydro keeps 113 MCP tools reliable without bloating the agent's context — tiered progressive disclosure, hot tools with full schemas, on-demand schema fetch via describe_tool, and self-correcting error responses.
---

# Tool Discovery & Context Injection

AI-Hydro ships **113 MCP tools**. Dumping every tool's full parameter schema into the agent's prompt would swamp the context window and, paradoxically, make a smaller driving model *less* reliable. AI-Hydro solves this with **tiered progressive disclosure**: the tools you use constantly are always fully visible, every other tool is always *listed*, and full schemas for the long tail are fetched on demand.

Nothing is ever hidden. The agent can always see that a tool exists; it just fetches the details when it needs them.

---

## The three disclosure levels

The Python server is the single source of truth — each tool is tagged with `_meta` (`tier`, `domain`, `hot`), and the extension renders accordingly:

| Level | What's injected | Which tools | Cost |
|-------|-----------------|-------------|------|
| **Full schema** | name + description + complete input schema | the **26 hot** tools (all Tier-1 core + a curated set of high-frequency Tier-2) | bounded — common workflows are zero-round-trip |
| **Summary line** | `name — one-line summary (domain)` | the remaining ~87 tools, grouped by domain | ~1 line per tool — every tool is always visible |
| **On demand** | full schema + a worked example | any summary-level tool | one round-trip via `describe_tool(name)` |

This keeps the prompt lean **and** keeps a weak driving model reliable: it gets full schemas for the hot path, and a dead-simple, reliable way to fetch a schema for anything else.

---

## Hot tools

A tool is **hot** when its schema is always in-context. Hot = all Tier-1 core tools plus a curated allowlist of frequent Tier-2 tools (e.g. `compute_spectral_index`, the data-fetch and session entry points). These are the calls that appear in almost every workflow, so the agent can make them correctly on the first try with no discovery step.

You can see which tools are hot in the [Complete Tool Reference](../tools/reference.md) — each carries a :material-fire: marker.

---

## The two-step discovery protocol

When the agent needs a tool that isn't hot, it follows a short, deterministic protocol:

1. **Browse** — `aihydro_describe_capability(domain)` returns a focused, one-line-per-tool summary of everything in a domain (e.g. *"what can I do with claims?"*). Good when the agent knows the area but not the exact tool.
2. **Drill down** — `describe_tool(name)` returns the **full input schema plus a copy-pasteable worked example** for one tool. This is the on-demand fetch that makes deferral safe — the agent gets a concrete example, not just a spec, right before its first call.

```text
aihydro_describe_capability("claims")   →  one line per claims tool
describe_tool("add_claim")              →  full schema + example call
```

This mirrors how the [Complete Tool Reference](../tools/reference.md) is organised — and in fact that page is generated from the very same registry the agent reads.

---

## Self-correcting errors

A small driving model's most common failure isn't hallucinating tools — it's **guessing parameter names** (`index` instead of `index_name`, `geojson` instead of the geometry param). AI-Hydro turns those guesses into successful calls instead of retry loops:

- **Silent repair** — before a tool body runs, common alias mistakes are mapped to the correct parameter names and obvious type mismatches are coerced. If repair makes the call valid, it just succeeds; the agent never sees the mistake.
- **Teaching errors** — if the call still can't be satisfied, the response is **not** a raw stack trace. It inlines (a) what was wrong in plain language, (b) the correct schema, (c) a corrected example call, and (d) the closest valid parameter names. The fix travels *in the error*, so the next attempt has everything it needs.
- **Retry-loop breaker** — if the exact same failing call repeats within a session, the guidance escalates rather than returning the same message.
- **Session auto-resolution** — when a tool needs a `session_id` and none is given, the layer falls back to the active session and tells the agent which one it used, instead of failing hard.

Together these make the tool surface resilient: a wrong call is a teaching turn, not a dead end.

---

## Why it's built server-side

All of this lives in the Python MCP server, not in extension-side filtering. The server tags tiers, marks hot tools, generates the worked examples, and repairs arguments. The extension is a pure renderer of that intent, and the [published reference](../tools/reference.md) is generated from the same source — so the docs, the agent's context, and the runtime behaviour can never drift apart.

---

## Related

- [Complete Tool Reference](../tools/reference.md) — every tool, tier, and hot marker
- [Skills](skills.md) — workflow playbooks that compose these tools
- [Models & Providers](providers.md) — choosing the driving model
