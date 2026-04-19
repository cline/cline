---
description: Index your PDF paper collection and synthesise across it with an AI agent. No vector database required — AI-Hydro folder-based literature module.
---

# Literature Module

The literature module lets you index your own PDF, text, and markdown documents and ask the agent to synthesise across them — without a vector database, embeddings, or any cloud service.

---

## How It Works

1. Drop files into the project's `literature/` folder
2. Call `index_literature` → builds a plain-text index with 800-character excerpts per document
3. Call `search_literature` with a query → returns matching excerpts
4. The agent synthesises the excerpts into an answer

No chromadb. No sentence-transformers. No API calls to a third-party service. Just text matching and LLM synthesis over your own files.

---

## Setting Up

### Add files to the literature folder

```
~/.aihydro/projects/new_england_basins/literature/
├── kratzert2018_lstm.pdf
├── addor2017_camels.pdf
├── newman2015_camels.pdf
└── my_notes.md
```

Supported formats: **PDF**, **txt**, **md**

!!! tip "PDF extraction"
    PDF text is extracted using `pypdf` or `pdfplumber` (installed automatically with `aihydro-tools[all]`). Scanned PDFs (image-only) will not extract usefully — use text-layer PDFs.

### Index the folder

```
Index the literature folder for the New England Basins project.
```

The agent calls `index_literature(project_name="new_england_basins")` and builds `literature_index.md` with one entry per document:

```markdown title="literature_index.md"
## kratzert2018_lstm.pdf
**Path:** ~/.aihydro/projects/.../kratzert2018_lstm.pdf
**Size:** 892 KB | **Indexed:** 2026-04-10T10:22:00Z

> Rainfall-runoff modelling using Long Short-Term Memory (LSTM) networks.
> We trained a single LSTM model on 241 basins from the CAMELS dataset...
> [800 chars]

---
```

---

## Searching

```
What do the papers in my library say about baseflow generation mechanisms?
```

```
Find papers that discuss the relationship between geology and BFI.
```

```
Summarise the methodology used in the CAMELS paper for attribute extraction.
```

`search_literature` returns the top-matching document excerpts, which the agent uses as context for synthesis.

### Return full document

For short documents (notes, summaries):

```
Show me the full content of my_notes.md.
```

Use `return_full_content=True` when you want the complete file rather than just excerpts.

---

## Limitations

| Limitation | Detail |
|-----------|--------|
| Search method | Text substring matching — not semantic/vector search |
| PDF quality | Text-layer PDFs only; scanned PDFs extract poorly |
| Index freshness | Re-run `index_literature` after adding new files |
| Context window | Very long documents may be truncated to excerpt length |

!!! info "Future: semantic search"
    Vector-based semantic search is available as a separate package (`aihydro-rag`). The folder-based module is intentionally dependency-free and sufficient for most research workflows.

---

## Typical Workflow

```
1. Collect PDFs into the literature/ folder
2. "Index the literature for my project"
3. "What do these papers say about [topic]?"
4. Agent synthesises → you refine → agent searches again
5. "Add a journal entry: the Kratzert paper's approach to basin attributes
    aligns well with what I'm seeing in the New England basins."
```
