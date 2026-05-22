# HTML Preview executable cells (`.aihydro-cell`)

Official contract for runnable Python/JavaScript cells inside HTML artifacts.

## DOM markup

```html
<div
  class="aihydro-cell"
  data-aihydro-cell-id="cell-001"
  data-language="python"
  data-execution="kernel"
>
  <pre class="aihydro-source">import math
print(math.sqrt(2))</pre>
  <div class="aihydro-output" aria-live="polite"></div>
</div>
```

- `data-language`: `python` | `javascript`
- `data-execution`: `kernel` (Python via extension) | `inline` (future)
- Optional `data-timeout-seconds` per cell

## JSON metadata (optional)

```html
<script type="application/vnd.aihydro.cell+json">
{"id":"cell-001","language":"python","execution":"kernel","timeoutSeconds":60,"dependsOn":[]}
</script>
```

`dependsOn` is reserved for future graph execution (not implemented yet).

## Panel toolbar

Users run cells from the HTML Preview panel: **Run Cell**, **Run All**, **Restart & Run All**, **Stop**, **Clear**.

## Python environment

Create `.aihydro/venv` with the agent, then refresh environments in the toolbar. Each artifact gets its own persistent kernel session (variables do not leak across artifacts unless `aihydro.htmlPreview.shareKernelAcrossArtifacts` is enabled).
