# Valyu Recipes & Use Cases

Practical patterns for common tasks from Valyu

---

## Recipe Collections

### Search Recipes (14 patterns)

| Recipe | Description |
|--------|-------------|
| [basic-search-all.md](search-recipes/basic-search-all.md) | Search across all sources |
| [basic-search-web.md](search-recipes/basic-search-web.md) | Web-only search |
| [basic-search-proprietary.md](search-recipes/basic-search-proprietary.md) | Licensed academic/research data |
| [news-search.md](search-recipes/news-search.md) | Real-time news search with date/country filtering |
| [academic-search.md](search-recipes/academic-search.md) | Academic papers (arXiv, PubMed, bioRxiv) |
| [finance-search.md](search-recipes/finance-search.md) | Financial data (stocks, SEC, earnings) |
| [healthcare-and-bio-search.md](search-recipes/healthcare-and-bio-search.md) | Clinical trials, drug labels, medical literature |
| [prediction-markets-search.md](search-recipes/prediction-markets-search.md) | Polymarket/Kalshi probability data |
| [monitor-for-breaking-news.md](search-recipes/monitor-for-breaking-news.md) | Track breaking news on topics |
| [track-news-for-brands.md](search-recipes/track-news-for-brands.md) | Brand monitoring and competitor comparison |
| [multi-topic-news-monitoring.md](search-recipes/multi-topic-news-monitoring.md) | Track multiple topics over time |
| [multi-step-search-workflow.md](search-recipes/multi-step-search-workflow.md) | Complex research with sub-queries |
| [using-collections-to-search.md](search-recipes/using-collections-to-search.md) | Reusable source collections |
| [tool-call.md](search-recipes/tool-call.md) | Optimize response format for AI agents |

### Content Recipes (6 patterns)

| Recipe | Description |
|--------|-------------|
| [basic-content-extraction-from-web.md](content-recipes/basic-content-extraction-from-web.md) | Extract clean markdown from URLs |
| [basic-content-extraction-from-web-with-summary.md](content-recipes/basic-content-extraction-from-web-with-summary.md) | Extract with AI summarization |
| [extract-content-from-research-paper.md](content-recipes/extract-content-from-research-paper.md) | Structured metadata from academic papers |
| [extract-product-data-from-online-product-info.md](content-recipes/extract-product-data-from-online-product-info.md) | Structured product information |
| [news-aggregator-from-content-extraction.md](content-recipes/news-aggregator-from-content-extraction.md) | Aggregate content from multiple news sources |
| [structured-content-extraction-from-web.md](content-recipes/structured-content-extraction-from-web.md) | Extract specific data using JSON schema |

### Answer Recipes (4 patterns)

| Recipe | Description |
|--------|-------------|
| [basic-answer.md](answer-recipes/basic-answer.md) | AI-synthesized answers from search |
| [answer-with-streaming.md](answer-recipes/answer-with-streaming.md) | Progressive real-time feedback |
| [answer-with-custom-instructions.md](answer-recipes/answer-with-custom-instructions.md) | Guide AI response formatting |

### DeepResearch Recipes (3 patterns)

| Recipe | Description |
|--------|-------------|
| [create-a-fast-research-task-and-await-completion.md](deepresearch-recipes/create-a-fast-research-task-and-await-completion.md) | Quick research (~5 min) |
| [create-a-standard-research-task-and-await-completion.md](deepresearch-recipes/create-a-standard-research-task-and-await-completion.md) | Balanced research (~10-20 min) |
| [create-a-heavy-research-task-and-await-completion.md](deepresearch-recipes/create-a-heavy-research-task-and-await-completion.md) | Comprehensive analysis (~90 min) |

---

## Quick Reference

### Which API to Use?

```
Need to find information?
  └── Search API → see search-recipes/

Need to extract content from URLs?
  └── Contents API → see content-recipes/

Need an AI-synthesized answer?
  └── Answer API → see answer-recipes/

Need comprehensive research report?
  └── DeepResearch API → see deepresearch-recipes/
```

### CLI Commands Summary

```bash
# Search
scripts/valyu search <type> <query> [maxResults]
# Types: web, paper, finance, bio, sec, economics, news, patent

# Content extraction
scripts/valyu contents <url> [--summary [instructions]] [--structured <schema>]

# AI answers
scripts/valyu answer <query> [--fast] [--structured <schema>]

# Deep research
scripts/valyu deepresearch create <query> [--model fast|standard|heavy] [--pdf]
scripts/valyu deepresearch status <task-id>
```

---

## Common Workflows

### Research Workflow

```bash
# 1. Quick search to find sources
scripts/valyu search paper "CRISPR therapeutic applications" 20

# 2. Extract key content
scripts/valyu contents "https://arxiv.org/paper" --summary "Key findings"

# 3. Deep analysis
scripts/valyu deepresearch create "CRISPR therapeutic applications review" --model heavy --pdf
```

### Financial Analysis Workflow

```bash
# 1. Get SEC filings
scripts/valyu search sec "Apple 10-K 2024" 10

# 2. Quick analysis
scripts/valyu answer "Apple Q4 2024 financial highlights" --fast

# 3. Structured report
scripts/valyu answer "Apple financial metrics" --structured '{"type":"object","properties":{"revenue":{"type":"string"},"growth":{"type":"string"}}}'
```

### News Monitoring Workflow

```bash
# 1. Track breaking news
scripts/valyu search news "AI regulation 2024" 20

# 2. Brand monitoring
scripts/valyu search news "Tesla news" 50

# 3. Synthesize findings
scripts/valyu answer "Latest AI regulation developments" --fast
```

### Content Processing Workflow

```bash
# 1. Extract article
scripts/valyu contents "https://example.com/article"

# 2. With summary
scripts/valyu contents "https://example.com/article" --summary "3 bullet points"

# 3. Structured extraction
scripts/valyu contents "https://example.com/product" --structured '{"type":"object","properties":{"name":{"type":"string"},"price":{"type":"number"}}}'
```

---

## Best Practices

1. **Start specific** - Use focused queries, then broaden if needed
2. **Use the right API** - Search for finding, Contents for extracting, Answer for synthesizing
3. **Leverage structured output** - Define JSON schemas for consistent responses
4. **Combine APIs** - Chain Search → Contents → Answer for complex tasks
5. **Monitor costs** - Check `cost` field, use `max_price` to cap spending
6. **Use fast mode** - When speed matters more than depth
