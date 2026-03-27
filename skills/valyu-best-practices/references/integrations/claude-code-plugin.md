# Claude Code Plugin Integration

The Valyu Search Plugin for Claude Code provides direct access to Valyu's search APIs through a CLI interface. This community-maintained tool (developed by GhouI) enables Claude Code to perform real-time searches across multiple data sources.

## Key Features

- **Zero Dependencies**: Uses Node.js built-in fetch for direct API calls
- **8 Search Types**: Web, finance, academic, biomedical, patents, SEC filings, economics, and news
- **AI-Powered Answers**: Returns results with source citations
- **Content Extraction**: Extracts clean content from any URL
- **Deep Research**: Asynchronous research reports for complex topics

## Installation

```bash
/plugin marketplace add valyuAI/valyu-search-plugin
/plugin install valyu-search-plugin@valyu-marketplace
```

## API Key Setup

Get your free API key at platform.valyu.ai ($10 credit included).

### Automatic Setup (Recommended)

Claude detects missing configuration on first use and prompts you to paste your API key, then saves it to `~/.valyu/config.json` automatically.

### Manual Setup Options

**Environment Variable (Zsh):**

```bash
echo 'export VALYU_API_KEY="your-api-key-here"' >> ~/.zshrc
source ~/.zshrc
```

**Config File:**

```bash
mkdir -p ~/.valyu
echo '{"apiKey": "your-api-key-here"}' > ~/.valyu/config.json
```

**VSCode Settings:**

Add to settings.json:

```json
{
  "terminal.integrated.env.osx": {
    "VALYU_API_KEY": "your-api-key-here"
  }
}
```

## Usage Syntax

**Natural Language**: "Search the web for AI developments in 2025"

**Structured Syntax**: `Valyu(searchType, "query", maxResults)`

### Search Types

| Type | Sources |
|------|---------|
| `web` | Real-time web content |
| `finance` | Stocks, earnings, SEC filings, crypto |
| `paper` | arXiv, PubMed, scholarly journals |
| `bio` | PubMed, clinical trials, FDA labels |
| `patent` | USPTO, global patent data |
| `sec` | 10-K, 10-Q, 8-K documents |
| `economics` | BLS, FRED, World Bank |
| `news` | Real-time news sources |

## Example Commands

```bash
Valyu(web, "AI developments 2025", 10)
Valyu(finance, "Apple Q4 2024 earnings", 8)
Valyu(paper, "transformer neural networks", 15)
Valyu(answer, "What is quantum computing?")
Valyu(contents, "https://example.com/article")
Valyu(deepresearch, create, "AI market trends 2025")
Valyu(deepresearch, status, "task-id-here")
```

## Output Format

Results return as structured JSON with `success`, `type`, `searchType`, `query`, `resultCount`, `results` array, and `cost`.

## Requirements

- Node.js 18+
- Valyu API key (free tier available)

## Support Resources

- **GitHub**: github.com/valyuAI/claude-search-plugin
- **Discord**: discord.gg/umtmSsppRY
- **API Documentation**: docs.valyu.ai
