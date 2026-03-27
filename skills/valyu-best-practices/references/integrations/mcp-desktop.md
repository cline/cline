# Local MCP Integration

The Valyu MCP Server is a Model Context Protocol tool enabling AI models to retrieve high-quality context from Valyu's API across multiple sources including proprietary datasets, Wikipedia, arXiv, PubMed, financial data, and web search.

## Prerequisites

- Python 3.10 or higher
- Claude Desktop (latest version)
- Valyu API Key from https://platform.valyu.ai

Verify Python installation: `python --version`

## Setup Instructions

### 1. Clone and Configure Environment

```bash
git clone https://github.com/valyuAI/valyu-mcp.git
cd valyu-mcp
```

Create virtual environment (macOS/Linux):

```bash
python -m venv .venv
source .venv/bin/activate
```

Windows:

```bash
python -m venv .venv
.venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Create `.env` file with your API credentials:

```bash
echo "VALYU_API_KEY=your-api-key-here" > .env
```

### 3. Configure Claude Desktop

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add this configuration:

```json
{
  "mcpServers": {
    "valyu-mcp": {
      "command": "/ABSOLUTE/PATH/TO/.venv/bin/python",
      "args": ["-u", "/ABSOLUTE/PATH/TO/valyu-mcp.py"],
      "env": {
        "VALYU_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Replace paths with absolute paths to your virtual environment and script.

## Testing

After restarting Claude Desktop:

1. **Look for Tools Icon** - A hammer icon appears when the MCP server runs successfully
2. **Inspect Available Tools** - Click hammer icon to verify "valyu-mcp" is listed
3. **Try Example Queries** - Test with queries like "What are the latest advancements in topological quantum computing"

Claude will indicate "Making a tool request: valyu-mcp" and fetch context from the API.

## Monitoring Logs

**macOS:**

```bash
tail -n 20 -F ~/Library/Logs/Claude/mcp*.log
```

**Windows:**

```powershell
Get-Content $env:APPDATA\Claude\Logs\mcp_valyu-mcp.log -Wait
```

Access logs through Claude Desktop: Settings > Developer > Open Logs Folder.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| ModuleNotFoundError | Ensure virtual environment is activated |
| Server Won't Start | Verify absolute paths in config are correct |
| No API Results | Check API key validity and available credits |

## Resources

- **Platform:** https://platform.valyu.ai (Get API key and free credits)
- **Documentation:** https://docs.valyu.ai
- **GitHub:** https://github.com/valyuAI/valyu-mcp
