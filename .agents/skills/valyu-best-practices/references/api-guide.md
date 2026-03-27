# Valyu API Reference Guide

Complete API documentation for all Valyu endpoints. Use this reference when implementing searches, content extraction, AI-powered answers, or deep research.

## API Overview

| Endpoint | Purpose | Best For |
|----------|---------|----------|
| `/v1/search` | Multi-source search | Finding information across web, academic, financial sources |
| `/v1/contents` | URL content extraction | Clean markdown from web pages, PDFs |
| `/v1/answer` | AI-powered answers | Questions requiring synthesis from multiple sources |
| `/v1/deepresearch` | Comprehensive research | In-depth reports with citations |
| `/v1/datasources` | Discover available data sources | Dynamic tool discovery, cost estimation |

## Authentication

All endpoints require the `x-api-key` header:
```
x-api-key: your_valyu_api_key
```

Get your API key at https://platform.valyu.ai ($10 free credits).

---

## Search API (`POST /v1/search`)

Real-time search across web, academic, financial, economic, medical research, news, patents, prediction markets, transportation and proprietary data sources.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | **required** | Search query (recommended: under 400 chars) |
| `search_type` | enum | `"all"` | `"all"`, `"web"`, `"proprietary"`, `"news"` |
| `max_num_results` | int | 10 | 1-20 (up to 100 with enhanced access) |
| `fast_mode` | bool | false | Faster responses, shorter results |
| `relevance_threshold` | float | 0.5 | Minimum relevance score (0.0-1.0) |
| `response_length` | enum | `"medium"` | `"short"` (25k), `"medium"` (50k), `"large"` (100k), `"max"` |
| `included_sources` | array | [] | Domains/datasets to include |
| `excluded_sources` | array | [] | Domains/datasets to exclude |
| `start_date` | string | null | Filter from date (YYYY-MM-DD) |
| `end_date` | string | null | Filter until date (YYYY-MM-DD) |
| `country_code` | string | null | 2-letter ISO code for geographic bias |

### Search Types Explained

- **`all`**: Searches everything - web, academic papers, financial data,economic, medical research, news, patents, prediction markets, transportation,proprietary sources
- **`web`**: General internet content only
- **`proprietary`**: Licensed academic papers, research, books
- **`news`**: News articles and current events

### Response Structure

```json
{
  "success": true,
  "tx_id": "tx_abc123",
  "results": [
    {
      "title": "Article Title",
      "url": "https://example.com/article",
      "content": "Full extracted content in markdown...",
      "source": "web",
      "relevance_score": 0.92,
      "publication_date": "2024-01-15",
      "length": 5420,
      "price": 0.002
    }
  ],
  "total_results": 10,
  "total_deduction_dollars": 0.025,
  "total_characters": 54200
}
```

### When to Use Search

- Finding recent information on any topic
- Academic research across arXiv, PubMed, bioRxiv
- Financial data from SEC filings, earnings reports
- News monitoring and current events
- Domain-specific searches with source filtering

---

## Contents API (`POST /v1/contents`)

Extract clean, structured content from web pages optimized for LLM processing.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `urls` | array | **required** | 1-10 URLs to process |
| `response_length` | enum/int | `"short"` | `"short"` (25k), `"medium"` (50k), `"large"` (100k), `"max"`, or custom int |
| `extract_effort` | enum | `"normal"` | `"normal"`, `"high"`, `"auto"` |
| `screenshot` | bool | false | Capture page screenshots |
| `summary` | bool/string/object | false | AI summarization options |

### Summary Options

```javascript
// Simple summary
summary: true

// Custom instructions
summary: "Extract key findings in bullet points"

// Structured extraction with JSON schema
summary: {
  type: "object",
  properties: {
    product_name: { type: "string" },
    price: { type: "number" },
    features: { type: "array", items: { type: "string" } }
  },
  required: ["product_name", "price"]
}
```

### Response Structure

```json
{
  "success": true,
  "tx_id": "tx_xyz789",
  "results": [
    {
      "title": "Page Title",
      "url": "https://example.com",
      "content": "Clean markdown content...",
      "description": "Meta description",
      "data_type": "unstructured",
      "length": 12840,
      "price": 0.002
    }
  ],
  "urls_requested": 1,
  "urls_processed": 1,
  "urls_failed": 0,
  "total_cost_dollars": 0.002
}
```

### When to Use Contents

- Extracting article text for summarization
- Parsing documentation for RAG systems
- Cleaning web pages before LLM processing
- Batch URL-to-text conversion
- Structured data extraction from product pages

---

## Answer API (`POST /v1/answer`)

AI-powered answers grounded in real-time search results with citations.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | **required** | Question to answer |
| `search_type` | enum | `"all"` | Source scope |
| `fast_mode` | bool | false | Lower latency, shorter results |
| `system_instructions` | string | null | Custom AI directives (max 2000 chars) |
| `structured_output` | object | null | JSON schema for formatted responses |
| `streaming` | bool | false | Enable SSE streaming |
| `data_max_price` | float | 1 | Dollar limit for search data |
| `included_sources` | array | [] | Domains to prioritize |
| `excluded_sources` | array | [] | Domains to exclude |
| `start_date` | string | null | Filter results from date |
| `end_date` | string | null | Filter results until date |
| `country_code` | string | null | Geographic bias |

### Structured Output Example

```javascript
structured_output: {
  type: "object",
  properties: {
    summary: { type: "string" },
    key_points: { type: "array", items: { type: "string" } },
    confidence: { type: "number" }
  }
}
```

### Response Structure

```json
{
  "success": true,
  "tx_id": "tx_answer123",
  "original_query": "What is quantum computing?",
  "contents": "Quantum computing is a type of computation...",
  "data_type": "unstructured",
  "search_results": [...],
  "search_metadata": {
    "number_of_results": 8,
    "total_characters": 45000
  },
  "cost": {
    "total_deduction_dollars": 0.045,
    "search_deduction_dollars": 0.025,
    "ai_deduction_dollars": 0.020
  }
}
```

### When to Use Answer

- Questions requiring current information synthesis
- Multi-source fact verification
- Technical documentation questions
- Research requiring cited sources
- Structured data extraction from search results

---

## DeepResearch API

Async comprehensive research with detailed reports and citations.

### Create Task (`POST /v1/deepresearch/tasks`)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | **required** | Research question |
| `model` | enum | `"standard"` | `"fast"` (~5 min), `"standard"` (~10-20 min), `"heavy"` (~90 min) |
| `output_format` | enum | `"markdown"` | `"markdown"`, `"pdf"`, or JSON schema |
| `included_sources` | array | [] | Sources to prioritize |
| `excluded_sources` | array | [] | Sources to exclude |
| `start_date` | string | null | Filter from date |
| `end_date` | string | null | Filter until date |

### Research Modes

| Mode | Duration | Best For |
|------|----------|----------|
| `fast` | ~5 minutes | Quick lookups, simple questions |
| `standard` | ~10-20 minutes | Balanced research, most use cases |
| `heavy` | ~90 minutes | Comprehensive analysis, complex topics |

### Check Status (`GET /v1/deepresearch/tasks/{id}/status`)

### Task Lifecycle

```
queued → running → completed/failed/cancelled
```

### Create Response

```json
{
  "success": true,
  "type": "deepresearch_create",
  "deepresearch_id": "f992a8ab-4c91-4322-905f-190107bd5a5b",
  "status": "queued",
  "query": "AI market trends 2024",
  "model": "standard"
}
```

### Status Response (Completed)

```json
{
  "success": true,
  "type": "deepresearch_status",
  "deepresearch_id": "f992a8ab-4c91-4322-905f-190107bd5a5b",
  "status": "completed",
  "query": "AI market trends 2024",
  "output": "# AI Market Trends 2024\n\n## Overview...",
  "pdf_url": "https://storage.valyu.ai/reports/...",
  "sources": [
    {
      "title": "Market Analysis 2024",
      "url": "https://example.com",
      "snippet": "Key findings...",
      "source": "web"
    }
  ],
  "progress": {
    "current_step": 5,
    "total_steps": 5
  },
  "usage": {
    "search_cost": 0.0075,
    "ai_cost": 0.15,
    "total_cost": 0.1575
  }
}
```

### When to Use DeepResearch

- Comprehensive market analysis
- Literature reviews
- Competitive intelligence
- Technical deep dives
- Topics requiring multi-source synthesis

---

## Datasources API

Discover available data sources dynamically. Useful for AI agents to understand what data is available without loading all definitions into context.

### List Datasources (`GET /v1/datasources`)

Returns all available datasources with metadata, pricing, and schemas.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `category` | string | null | Filter by category (optional) |

**Valid categories:** `research`, `healthcare`, `patents`, `markets`, `company`, `economic`, `predictions`, `transportation`, `legal`, `politics`

### Response Structure

```json
{
  "success": true,
  "datasources": [
    {
      "id": "valyu/valyu-arxiv",
      "name": "Arxiv",
      "description": "Over 1 million pre-print research papers...",
      "category": "research",
      "type": "text",
      "modality": ["text", "image"],
      "topics": ["physics", "computer science", "mathematics"],
      "example_queries": ["transformer attention mechanism"],
      "pricing": { "cpm": 0.50 },
      "response_schema": {},
      "update_frequency": "daily",
      "size": 1000000,
      "coverage": {
        "start_date": "1991-01-01",
        "end_date": null
      }
    }
  ],
  "total_count": 25,
  "categories": {
    "research": { "name": "Research & Academic", "count": 4 },
    "markets": { "name": "Financial Markets", "count": 7 }
  }
}
```

### List Categories (`GET /v1/datasources/categories`)

Returns all available categories with dataset counts.

### Response Structure

```json
{
  "success": true,
  "categories": [
    {
      "id": "research",
      "name": "Research & Academic",
      "description": "Academic papers and research publications",
      "dataset_count": 4
    },
    {
      "id": "markets",
      "name": "Financial Markets",
      "description": "Real-time and historical market data",
      "dataset_count": 7
    },
    {
      "id": "healthcare",
      "name": "Healthcare & Medical",
      "description": "Clinical trials, drug information, and health data",
      "dataset_count": 4
    }
  ]
}
```

### When to Use Datasources API

- Discovering available data sources at runtime
- Building dynamic tool registries
- Cost estimation before search requests
- Understanding response schemas for structured extraction
- Filtering searches to specific datasets via `included_sources`

### Example: Find and Use a Datasource

```bash
# 1. List available research datasources
curl -X GET "https://api.valyu.ai/v1/datasources?category=research" \
  -H "x-api-key: your_key"

# 2. Use discovered datasource ID in search
scripts/valyu search paper "quantum computing" 10
# This uses included_sources: ["valyu/valyu-arxiv", "valyu/valyu-pubmed", ...]
```

---

## Error Codes

| Status | Description |
|--------|-------------|
| 400 | Invalid parameters or malformed request |
| 401 | Missing or invalid API key |
| 402 | Insufficient credits |
| 403 | API key lacks required permissions |
| 422 | All URLs failed (Contents API) |
| 500 | Server error |

## Choosing the Right API

```
Need to find information?
  └── Use Search API

Need to extract content from specific URLs?
  └── Use Contents API

Need an AI-synthesized answer with sources?
  └── Use Answer API

Need comprehensive research report?
  └── Use DeepResearch API

Need to discover available data sources?
  └── Use Datasources API
```
