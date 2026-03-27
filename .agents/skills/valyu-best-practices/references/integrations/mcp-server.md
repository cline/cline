# Remote MCP Integration

Valyu's Remote MCP enables AI assistants like Claude to perform real-time searches across academic papers, web content, and financial data without local server setup.

## Quick Setup

**MCP Server URL:**
```
https://mcp.valyu.ai/mcp?valyuApiKey=your-valyu-api-key
```

Get your API key at [platform.valyu.ai](https://platform.valyu.ai/user/account/apikeys).

## Configuration Methods

### Claude Desktop

Add to your configuration file:

```json
{
  "mcpServers": {
    "valyu": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.valyu.ai/mcp?valyuApiKey=your-valyu-api-key"
      ]
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add --transport http valyuMcp "https://mcp.valyu.ai/mcp?valyuApiKey=YOUR_API_KEY"
```

### OpenAI Responses API (Python)

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
  model="gpt-5",
  input=[],
  text={"format": {"type": "text"}},
  reasoning={},
  tools=[
    {
      "type": "mcp",
      "server_label": "Valyu",
      "server_url": "https://mcp.valyu.ai/mcp?valyuApiKey=VALYU_API_KEY",
      "allowed_tools": [
        "valyu_search",
        "valyu_academic_search",
        "valyu_financial_search",
        "valyu_sec_search",
        "valyu_company_research",
        "valyu_patents",
        "valyu_bio_search",
        "valyu_economics_search",
        "valyu_contents",
        "valyu_datasources",
        "valyu_datasources_categories"
      ],
      "require_approval": "always"
    }
  ],
  temperature=1,
  max_output_tokens=2048,
  top_p=1,
  store=True
)
```

## Available Tools

| Tool | Purpose |
|------|---------|
| `valyu_search` | Web search with full page content |
| `valyu_academic_search` | ArXiv, PubMed, scholarly journals |
| `valyu_financial_search` | Real-time stocks, crypto, earnings |
| `valyu_sec_search` | 10-K, 10-Q, 8-K filings |
| `valyu_company_research` | Company intelligence (9 sections in ~10 seconds) |
| `valyu_patents` | USPTO and global patent databases |
| `valyu_bio_search` | Clinical trials, FDA labels, drug data |
| `valyu_economics_search` | BLS, FRED, World Bank data |
| `valyu_contents` | URL content extraction as markdown |
| `valyu_datasources` | Discover available datasets |
| `valyu_datasources_categories` | Browse data source categories |

## Key Features

- **11 specialized tools** spanning research, finance, healthcare, and economics
- **Parallel execution**: Company research completes 4x faster than sequential queries
- **Real-time data**: Live stock prices, crypto rates, insider trading
- **Full-text search**: Complete academic papers and SEC documents
- **36+ integrated datasets** across multiple domains
- **HTTP/SSE transport** for OpenAI Responses API compatibility

## Cost Control

Limit spending per search:

```
https://mcp.valyu.ai/mcp?valyuApiKey=your-key&maxPrice=50
```

Recommended range: 30-100 CPM ($0.03-$0.10) for most use cases.

## Resources

- **Platform**: [platform.valyu.ai](https://platform.valyu.ai)
- **Docs**: [docs.valyu.ai](https://docs.valyu.ai)
- **GitHub**: [github.com/valyuAI](https://github.com/valyuAI)
