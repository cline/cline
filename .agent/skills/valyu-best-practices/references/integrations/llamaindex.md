# LlamaIndex Integration

Valyu integrates seamlessly with LlamaIndex as a comprehensive tool spec, allowing you to enhance your AI agents and RAG applications with real-time web search and proprietary data sources.

The package includes two main functions:

- **`search()`**: Deep search operations with comprehensive parameter control
- **`get_contents()`**: Extract clean content from specific URLs

## Installation

```bash
pip install llama-index-tools-valyu
```

Configure credentials:

```bash
export VALYU_API_KEY="your-api-key-here"
```

## Basic Usage

### ValyuToolSpec for Deep Search

```python
import os
from llama_index.tools.valyu import ValyuToolSpec

os.environ["VALYU_API_KEY"] = "your-api-key-here"

valyu_tool = ValyuToolSpec(
    api_key=os.environ["VALYU_API_KEY"],
    verbose=True,
    max_price=100,
    relevance_threshold=0.5,
    fast_mode=False,
)

search_results = valyu_tool.search(
    query="What are agentic search-enhanced large reasoning models?",
    search_type="all",
    max_num_results=5,
)

for doc in search_results:
    print(f"Title: {doc.metadata['title']}")
    print(f"Content: {doc.text[:200]}...")
    print(f"Source: {doc.metadata['url']}")
    print(f"Relevance: {doc.metadata['relevance_score']}")
```

### ValyuToolSpec for Content Extraction

```python
valyu_tool = ValyuToolSpec(
    api_key=os.environ["VALYU_API_KEY"],
    verbose=True,
    contents_summary=True,
    contents_extract_effort="high",
    contents_response_length="medium",
)

urls = [
    "https://arxiv.org/abs/1706.03762",
    "https://en.wikipedia.org/wiki/Transformer_(machine_learning_model)"
]

content_results = valyu_tool.get_contents(urls=urls)

for doc in content_results:
    print(f"URL: {doc.metadata['url']}")
    print(f"Title: {doc.metadata['title']}")
    print(f"Content: {doc.text[:300]}...")
```

### Using with LlamaIndex OpenAI Agents

```python
import os
from llama_index.agent.openai import OpenAIAgent
from llama_index.tools.valyu import ValyuToolSpec

os.environ["VALYU_API_KEY"] = "your-valyu-api-key"
os.environ["OPENAI_API_KEY"] = "your-openai-api-key"

valyu_tool = ValyuToolSpec(
    api_key=os.environ["VALYU_API_KEY"],
    max_price=100,
    fast_mode=True,
    contents_summary=True,
    contents_extract_effort="normal",
    contents_response_length="medium",
)

agent = OpenAIAgent.from_tools(
    valyu_tool.to_tool_list(),
    verbose=True,
)

search_response = agent.chat(
    "What are the key considerations for implementing statistical arbitrage strategies?"
)
print(search_response)
```

## Advanced Configuration

### Comprehensive Parameter Configuration

```python
valyu_tool = ValyuToolSpec(
    api_key="your-api-key",
    verbose=True,
    max_price=100,
    relevance_threshold=0.5,
    fast_mode=False,
    included_sources=["arxiv.org", "pubmed.ncbi.nlm.nih.gov"],
    excluded_sources=["reddit.com", "twitter.com"],
    response_length="medium",
    country_code="US",
    contents_summary=True,
    contents_extract_effort="high",
    contents_response_length="large",
)

results = valyu_tool.search(
    query="quantum computing breakthroughs 2024",
    search_type="all",
    max_num_results=10,
    start_date="2024-01-01",
    end_date="2024-12-31",
)
```

### Source Filtering Examples

```python
# Academic-focused configuration
academic_tool = ValyuToolSpec(
    api_key=os.environ["VALYU_API_KEY"],
    included_sources=[
        "arxiv.org",
        "pubmed.ncbi.nlm.nih.gov",
        "ieee.org",
        "nature.com",
        "sciencedirect.com"
    ],
    response_length="large",
    relevance_threshold=0.7
)

# News and current events configuration
news_tool = ValyuToolSpec(
    api_key=os.environ["VALYU_API_KEY"],
    excluded_sources=["reddit.com", "twitter.com", "facebook.com"],
    fast_mode=True,
    country_code="US",
    response_length="short"
)
```

## Example: Financial Research Assistant

```python
from llama_index.agent.openai import OpenAIAgent
from llama_index.tools.valyu import ValyuToolSpec

financial_tool = ValyuToolSpec(
    api_key=os.environ["VALYU_API_KEY"],
    max_price=100,
    fast_mode=True,
    excluded_sources=["reddit.com", "twitter.com"],
    response_length="medium",
    country_code="US",
    contents_summary=True,
    contents_extract_effort="high",
    contents_response_length="large"
)

financial_agent = OpenAIAgent.from_tools(
    financial_tool.to_tool_list(),
    verbose=True,
    system_prompt="""You are a financial research assistant. Use Valyu to search for:
    - Real-time market data and news
    - Academic research on financial models
    - Economic indicators and analysis

    Always cite your sources and provide context about data recency."""
)

response = financial_agent.chat(
    "What are the latest developments in cryptocurrency regulation?"
)
print(response)
```

## API Reference

### ValyuToolSpec Initialization Parameters

- **`api_key`** (required): Valyu API key
- **`verbose`**: Enable verbose logging (default: False)
- **`max_price`**: Maximum cost in dollars for search operations
- **`relevance_threshold`**: Minimum relevance score 0.0-1.0 (default: 0.5)
- **`fast_mode`**: Enable fast mode for faster results (default: False)
- **`included_sources`**: List of URLs/domains to include
- **`excluded_sources`**: List of URLs/domains to exclude
- **`response_length`**: "short", "medium", "large", "max"
- **`country_code`**: 2-letter ISO country code
- **`contents_summary`**: AI summary config (bool, str, or dict)
- **`contents_extract_effort`**: "normal", "high", or "auto"
- **`contents_response_length`**: Content length per URL

### search() Method Parameters

- **`query`** (required): Natural language search query
- **`search_type`**: `"all"`, `"web"`, `"proprietary"`, or `"news"` (default: "all")
- **`max_num_results`**: 1-20 results (default: 5)
- **`start_date`/`end_date`**: Time filtering (YYYY-MM-DD)
- **`fast_mode`**: Override tool default

### get_contents() Method Parameters

- **`urls`** (required): List of URLs to extract (max 10 per request)

## Resources

- [LlamaIndex Valyu Tool](https://llamahub.ai/l/tools/llama-index-tools-valyu) - LlamaHub documentation
- [API Reference](https://docs.valyu.ai/api-reference) - Complete Valyu API documentation
- [Get API Key](https://platform.valyu.ai) - Sign up for free $10 credit
