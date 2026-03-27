# LangChain Integration

Valyu integrates seamlessly with LangChain as a search tool, allowing you to enhance your AI agents and RAG applications with real-time web search and proprietary data sources.

The package includes two main tools:

- **`ValyuSearchTool`**: Deep search operations with comprehensive parameter control
- **`ValyuContentsTool`**: Extract clean content from specific URLs

## Installation

```bash
pip install -U langchain-valyu
```

Configure credentials:

```bash
export VALYU_API_KEY="your-valyu-api-key-here"
```

For agent examples:

```bash
export ANTHROPIC_API_KEY="your-anthropic-api-key"
export OPENAI_API_KEY="your-openai-api-key"
```

## Basic Usage

### ValyuSearchTool for Deep Search

```python
import os
from langchain_valyu import ValyuSearchTool

os.environ["VALYU_API_KEY"] = "your-api-key-here"

tool = ValyuSearchTool()

search_results = tool._run(
    query="What are agentic search-enhanced large reasoning models?",
    search_type="all",
    max_num_results=5,
    relevance_threshold=0.5,
    max_price=30.0
)

print("Search Results:", search_results.results)
```

### ValyuContentsTool for Content Extraction

```python
from langchain_valyu import ValyuContentsTool

contents_tool = ValyuContentsTool()

urls = [
    "https://arxiv.org/abs/2301.00001",
    "https://example.com/article",
]

extracted_content = contents_tool._run(urls=urls)

for result in extracted_content.results:
    print(f"URL: {result['url']}")
    print(f"Title: {result['title']}")
    print(f"Content: {result['content'][:200]}...")
```

### Using with LangChain Agents

```bash
pip install langchain-anthropic langgraph
```

```python
import os
from langchain_valyu import ValyuSearchTool
from langchain_anthropic import ChatAnthropic
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage

os.environ["VALYU_API_KEY"] = "your-valyu-api-key"
os.environ["ANTHROPIC_API_KEY"] = "your-anthropic-api-key"

llm = ChatAnthropic(model="claude-sonnet-4-20250514")
valyu_search_tool = ValyuSearchTool()

agent = create_react_agent(llm, [valyu_search_tool])

user_input = "What are the key factors driving recent stock market volatility?"

for step in agent.stream(
    {"messages": [HumanMessage(content=user_input)]},
    stream_mode="values",
):
    step["messages"][-1].pretty_print()
```

## Advanced Configuration

### Search Parameters

```python
results = tool._run(
    query="quantum computing breakthroughs 2024",
    search_type="proprietary",
    max_num_results=10,
    relevance_threshold=0.6,
    max_price=30.0,
    is_tool_call=True,
    start_date="2024-01-01",
    end_date="2024-12-31",
    included_sources=["arxiv.org", "nature.com"],
    excluded_sources=["reddit.com"],
    response_length="medium",
    country_code="US",
    fast_mode=False,
)
```

### Source Filtering

```python
# Include only academic sources
academic_results = tool._run(
    query="machine learning research 2024",
    search_type="proprietary",
    included_sources=["arxiv.org", "pubmed.ncbi.nlm.nih.gov", "ieee.org"],
    max_num_results=8
)

# Exclude social media
filtered_results = tool._run(
    query="AI policy developments",
    search_type="web",
    excluded_sources=["reddit.com", "twitter.com", "facebook.com"],
    max_num_results=10
)
```

## Example: Financial Research Assistant

```python
from langchain_valyu import ValyuSearchTool
from langchain_anthropic import ChatAnthropic
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage, SystemMessage

financial_llm = ChatAnthropic(model="claude-sonnet-4-20250514")
valyu_tool = ValyuSearchTool()

financial_agent = create_react_agent(financial_llm, [valyu_tool])

query = "What are the latest developments in cryptocurrency regulation?"

system_context = SystemMessage(content="""You are a financial research assistant. Use Valyu to search for:
- Real-time market data and news
- Academic research on financial models
- Economic indicators and analysis

Always cite your sources and provide context about data recency.""")

for step in financial_agent.stream(
    {"messages": [system_context, HumanMessage(content=query)]},
    stream_mode="values",
):
    step["messages"][-1].pretty_print()
```

## API Reference

### ValyuSearchTool Parameters

- **`query`** (required): Natural language search query
- **`search_type`**: `"all"`, `"web"`, `"proprietary"`, or `"news"` (default: "all")
- **`max_num_results`**: 1-20 results (default: 5)
- **`relevance_threshold`**: 0.0-1.0 relevance score (default: 0.5)
- **`max_price`**: Maximum cost in CPM
- **`is_tool_call`**: Optimize for LLM consumption (default: true)
- **`start_date`/`end_date`**: Time filtering (YYYY-MM-DD)
- **`included_sources`/`excluded_sources`**: URL/domain filtering
- **`response_length`**: "short", "medium", "large", "max"
- **`country_code`**: 2-letter ISO country code
- **`fast_mode`**: Enable for faster results (default: false)

### ValyuContentsTool Parameters

- **`urls`** (required): List of URLs to extract (max 10 per request)

## Resources

- [LangChain Valyu Tool](https://python.langchain.com/docs/integrations/tools/valyu) - Official documentation
- [API Reference](https://docs.valyu.ai/api-reference) - Complete Valyu API documentation
- [Get API Key](https://platform.valyu.ai) - Sign up for free $10 credit
