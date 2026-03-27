# Valyu Search Prompting Guide

Best practices for writing effective queries that return high-quality, relevant results.

## Core Principle

**Better queries = better results.** Precise queries yield more relevant information, reducing noise and improving AI response quality.

## Query Anatomy

Effective searches combine four elements:

| Element | Description | Example |
|---------|-------------|---------|
| **Intent** | What specific knowledge you need | "latest advancements" vs "overview" |
| **Domain** | Topic-specific terminology | "transformer architecture" vs "AI model" |
| **Constraints** | Relevance filters | "2024", "peer-reviewed", "clinical trial" |
| **Source type** | Where to look | academic papers, SEC filings, news |

## Query Length

**Keep queries under 400 characters.** Use focused phrasing, not lengthy explanations.

```
# Too long
"I'm looking for information about the latest developments in artificial
intelligence, specifically focusing on large language models and their
applications in healthcare settings, preferably from recent peer-reviewed
academic papers published in 2024"

# Better
"large language models healthcare applications 2024 peer-reviewed"
```

## Split Complex Requests

Break multifaceted research into separate, targeted queries.

```
# Don't do this
"everything about Tesla including stock performance, new products,
and Elon Musk tweets"

# Do this instead
Query 1: "Tesla stock performance Q4 2024"
Query 2: "Tesla Cybertruck production updates 2024"
Query 3: "Tesla FSD autonomous driving progress"
```

## Avoid Search Operators

Valyu uses semantic search. Don't use traditional operators:

```
# Don't use
site:arxiv.org transformer attention
"exact phrase match"
machine learning OR deep learning

# Instead use
transformer attention mechanism arxiv
transformer attention mechanism research
machine learning deep learning applications
```

Use `included_sources` parameter instead of site: operators.

## Domain-Specific Queries

### Academic/Research
```
# Good: Specific terminology + constraints
"CRISPR gene editing off-target effects 2024"
"attention mechanism transformer architecture survey"
"GLP-1 receptor agonists weight loss clinical trials"

# Bad: Vague
"gene editing research"
"AI papers"
"diabetes medication studies"
```

### Financial
```
# Good: Specific metrics + timeframe
"Apple revenue growth Q4 2024 earnings"
"NVIDIA GPU market share datacenter 2024"
"Federal Reserve interest rate decision December 2024"

# Bad: Too broad
"Apple financial information"
"tech stocks"
"interest rates"
```

### News/Current Events
```
# Good: Specific event + recency
"OpenAI GPT-5 announcement 2024"
"EU AI Act implementation timeline"
"SpaceX Starship test flight results"

# Bad: Generic
"AI news"
"space news"
"tech regulations"
```

## Parameter Combinations

Combine good queries with API parameters:

```javascript
{
  query: "mRNA vaccine cancer immunotherapy clinical trials",
  search_type: "proprietary",
  included_sources: ["pubmed", "biorxiv"],
  start_date: "2024-01-01",
  relevance_threshold: 0.7,
  max_num_results: 15
}
```

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| Vague terms | Too many irrelevant results | Use specific terminology |
| No timeframe | Outdated information | Add date constraints |
| Too many topics | Diluted relevance | Split into multiple queries |
| Filler words | Wasted tokens | Remove "I want to know about" |
| Wrong source type | Missing relevant data | Match search_type to need |

## Query Templates by Use Case

### Market Research
```
"{company} {metric} {timeframe} {source_type}"
→ "Tesla revenue growth Q4 2024 SEC filing"
```

### Academic Literature
```
"{topic} {methodology} {finding_type} {year}"
→ "transformer architecture attention mechanism survey 2024"
```

### Competitive Analysis
```
"{company} vs {competitor} {aspect} {year}"
→ "OpenAI vs Anthropic API pricing comparison 2024"
```

### Technical Documentation
```
"{technology} {specific_feature} {use_case}"
→ "React Server Components data fetching patterns"
```

### News Monitoring
```
"{entity} {event_type} {timeframe}"
→ "Federal Reserve policy announcement December 2024"
```

## Iterative Refinement

Start broad, then narrow based on results:

```
Round 1: "AI chip market 2024"
→ Too many results, mixed relevance

Round 2: "AI inference chip market share datacenter 2024"
→ Better focus, still broad

Round 3: "NVIDIA H100 vs AMD MI300 inference performance benchmark"
→ Specific, actionable results
```

## Source Filtering Best Practices

Use `included_sources` for domain authority:

```javascript
// Academic research
included_sources: ["arxiv", "pubmed", "nature", "science"]

// Financial analysis
included_sources: ["sec.gov", "bloomberg", "reuters", "wsj"]

// Tech news
included_sources: ["techcrunch", "theverge", "arstechnica"]

// Official documentation
included_sources: ["docs.python.org", "react.dev", "developer.mozilla.org"]
```

## Relevance Threshold Tuning

| Threshold | Use Case |
|-----------|----------|
| 0.3-0.5 | Exploratory research, broad coverage |
| 0.5-0.7 | Balanced precision/recall (default) |
| 0.7-0.9 | High precision, authoritative sources only |
| 0.9+ | Exact matches, very specific queries |

## Summary

1. **Be specific** - Use domain terminology
2. **Be concise** - Under 400 characters
3. **Be focused** - One topic per query
4. **Use parameters** - Combine query + filters
5. **Iterate** - Refine based on results
