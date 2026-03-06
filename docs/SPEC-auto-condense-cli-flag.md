# Spec: `--auto-condense` CLI Flag

## Problem

In SWE-bench evaluation, 37/182 failures (20%) were "never submitted" — the agent worked but never called `attempt_completion`. A major sub-cause is context exhaustion: the agent fills the context window, hits mechanical truncation (which drops conversation history without summarization), loses its working context, and can't recover.

Cline already has `useAutoCondense` — an AI-powered compaction that summarizes the conversation before truncating. But it defaults to `false` and there's no CLI flag to enable it. The only way to set it is through the VS Code settings UI.

## Design

Add `--auto-condense` as a boolean CLI flag, following the exact pattern of `--double-check-completion`.

### Changes to `cli/src/index.ts`

**1. Add to `TaskOptions` interface (~line 64):**

```typescript
doubleCheckCompletion?: boolean
autoCondense?: boolean  // ← add here
```

**2. Add to `applyTaskOptions()` (~line 202, after the double-check block):**

```typescript
if (options.autoCondense) {
    StateManager.get().setGlobalState("useAutoCondense", true)
}
```

No telemetry event needed — this is an eval-only flag for now.

**3. Add `.option()` to both command definitions:**

In the `task` command (~line 740, after `--double-check-completion`):
```
.option("--auto-condense", "Enable AI-powered context compaction instead of mechanical truncation")
```

In the default/interactive command (~line 907, after `--double-check-completion`):
```
.option("--auto-condense", "Enable AI-powered context compaction instead of mechanical truncation")
```

### Changes to Harbor `cline.py`

**1. Add kwarg to `__init__` (~line 65, after `max_consecutive_mistakes`):**

```python
auto_condense: bool | str | None = None,
```

**2. Normalize kebab-case alias (~line 126, after the max-consecutive-mistakes block):**

```python
if auto_condense is None:
    auto_condense = kwargs.pop("auto-condense", None)
else:
    kwargs.pop("auto-condense", None)
```

**3. Parse boolean (~line 220, after the max_consecutive_mistakes block):**

```python
self._auto_condense: bool | None = None
if auto_condense is not None:
    if isinstance(auto_condense, bool):
        self._auto_condense = auto_condense
    elif isinstance(auto_condense, str):
        normalized_bool = auto_condense.strip().lower()
        if normalized_bool in {"1", "true", "yes", "on"}:
            self._auto_condense = True
        elif normalized_bool in {"0", "false", "no", "off"}:
            self._auto_condense = False
        else:
            raise ValueError(
                f"Invalid auto_condense value: '{auto_condense}'. "
                "Valid values: true|false|1|0|yes|no|on|off"
            )
```

**4. Add to run flags (~line 557, after the max-consecutive-mistakes block):**

```python
if self._auto_condense:
    run_flags.append("--auto-condense")
```

**5. Add to pre-run metadata (~line 360, after `max_consecutive_mistakes`):**

```python
"auto_condense": self._auto_condense,
```

**6. Update docstring (~line 35, after the max-consecutive-mistakes line):**

```
--agent-kwarg auto-condense=<bool>     Passes --auto-condense when true
```

## Usage

```bash
# Direct CLI
cline -y --auto-condense -- "Fix the bug in parser.py"

# Via Harbor
python -m harbor run swe-bench \
    --agent cline-cli \
    --ak auto-condense=true \
    --ak max-consecutive-mistakes=15
```

## What NOT to do

- Do NOT add a value parameter (like `--auto-condense <mode>`). It's a boolean toggle, same as `--double-check-completion`. The underlying state key is already boolean.
- Do NOT change the `useAutoCondense` state key name or its behavior in `ContextManager`. That code already works — we're just exposing the toggle.
- Do NOT gate this on `isNextGenModelFamily()` in the CLI flag handler. That check already exists in the context management code (`src/core/task/index.ts` line ~2380). The CLI just sets the state; the runtime decides whether to use it.

## Files to change

| File | Change |
|------|--------|
| `cli/src/index.ts` | Add `autoCondense` to `TaskOptions`, `applyTaskOptions()`, and both `.option()` blocks |
| `harbor/.../cline/cline.py` | Add kwarg, parsing, run flag, metadata, docstring |

## Testing

```bash
# CLI unit tests
cd cli && npm test

# Harbor unit tests
cd harbor && python -m pytest tests/unit/agents/installed/test_cline_cli.py -v
```

No snapshot updates needed — this doesn't touch system prompts.

## Note on `isNextGenModelFamily` gate

Auto-condense currently only activates when `useAutoCondense && isNextGenModelFamily(modelId)` (see `src/core/task/index.ts` line ~2380). Gemini 3 Flash IS a next-gen model family, so this will work for our eval runs. If you want auto-condense for non-next-gen models too, that's a separate change in `ContextManager` — not part of this spec.
