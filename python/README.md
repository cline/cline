# ⚠️ DEPRECATED — This directory is frozen at v1.2.1

**Do not develop against or import from `python/ai_hydro/` in this repository.**

The canonical Python MCP server package has moved to a standalone repository
and is published to PyPI. This copy is retained only for historical reference.

## Use the standalone package instead

```bash
pip install aihydro-tools          # production
pip install -e ".[all,dev]"        # development (clone the standalone repo)
```

Standalone repo: **github.com/AI-Hydro/aihydro-tools**

## Why this copy is stale

| Aspect | This directory | Standalone (aihydro-tools) |
|--------|---------------|---------------------------|
| Version | 1.2.1 | 1.6.0 |
| Tool modules | 5 | 13 |
| Missing modules | tools_validators, tools_ledger, tools_knowledge, tools_skills, tools_execution, tools_workflows, enforcement, resources | — |
| Epistemic status validator | ✗ | ✓ |
| EvidenceSpan schema | ✗ | ✓ |
| KnowledgeConflictError | ✗ | ✓ |
| aihydro.verified namespace | ✗ | ✓ |
| aihydro-bench coverage | ✗ | ✓ (23 tasks) |

## VS Code extension usage

The extension's `ensureDefaultMcpServer.ts` registers the `aihydro-mcp`
console script from the standalone PyPI package. It does NOT reference this
`python/` directory at runtime.

## Migration checklist

- [ ] Uninstall any editable install of this directory: `pip uninstall aihydro-tools`
- [ ] Install from the standalone repo: `pip install aihydro-tools` or `pip install -e ".[all,dev]"`
- [ ] Verify 56 tools: `aihydro-mcp --check`
- [ ] Run tests from the standalone repo: `pytest tests/ -m "not live"`
