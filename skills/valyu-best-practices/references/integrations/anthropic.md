# Anthropic Integration

Integrate Valyu's deep search capabilities directly into your Anthropic Claude applications using the provider system. This enables your AI agents to access real-time information from academic papers, news, financial data, and authoritative sources.

## Installation

```bash
pip install valyu anthropic
```

Set your API keys:

```bash
export VALYU_API_KEY="your-valyu-api-key"
export ANTHROPIC_API_KEY="your-anthropic-api-key"
```

## Basic Usage

```python
from anthropic import Anthropic
from valyu import AnthropicProvider
from dotenv import load_dotenv

load_dotenv()

# Initialize clients
anthropic_client = Anthropic()
provider = AnthropicProvider()

# Get Valyu tools
tools = provider.get_tools()

# Create a research request
messages = [
    {
        "role": "user",
        "content": "What are the latest developments in quantum computing? Write a summary of your findings."
    }
]

# Step 1: Call Anthropic with tools
response = anthropic_client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1000,
    tools=tools,
    messages=messages,
)

# Step 2: Execute tool calls
tool_results = provider.handle_tool_calls(response=response)

# Step 3: Get final response with search results
if tool_results:
    updated_messages = provider.build_conversation(messages, response, tool_results)
    final_response = anthropic_client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        messages=updated_messages,
    )

    for content in final_response.content:
        if hasattr(content, "text"):
            print(content.text)
```

## How It Works

The `AnthropicProvider` handles everything:

1. **Tool Registration**: Automatically formats Valyu search as an Anthropic tool
2. **Tool Execution**: Manages search API calls behind the scenes
3. **Conversation Flow**: Builds proper message sequences with tool results

## Research Agent Example

```python
from anthropic import Anthropic
from valyu import AnthropicProvider

def create_research_agent():
    client = Anthropic()
    provider = AnthropicProvider()
    tools = provider.get_tools()

    def research(query: str) -> str:
        system_prompt = """You are a research assistant with access to real-time information. Always cite your sources."""

        messages = [{"role": "user", "content": query}]

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            tools=tools,
            messages=messages,
            system=system_prompt
        )

        tool_results = provider.handle_tool_calls(response=response)

        if tool_results:
            updated_messages = provider.build_conversation(messages, response, tool_results)
            final_response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2000,
                messages=updated_messages,
                system=system_prompt
            )

            result = ""
            for content in final_response.content:
                if hasattr(content, "text"):
                    result += content.text
            return result

        result = ""
        for content in response.content:
            if hasattr(content, "text"):
                result += content.text
        return result

    return research

# Usage
agent = create_research_agent()
result = agent("Find the price of Bitcoin and Nvidia over the last 2 years")
print(result)
```

## Financial Analysis Example

```python
def create_financial_agent():
    client = Anthropic()
    provider = AnthropicProvider()
    tools = provider.get_tools()

    def analyze_market(assets: list) -> str:
        query = f"Get the latest news and price data for {', '.join(assets)}, then provide a detailed market analysis report"

        messages = [{"role": "user", "content": query}]

        system_prompt = "You are a financial analyst. Provide data-driven insights with specific numbers and sources."

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            tools=tools,
            messages=messages,
            system=system_prompt
        )

        tool_results = provider.handle_tool_calls(response=response)

        if tool_results:
            updated_messages = provider.build_conversation(messages, response, tool_results)
            final_response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2500,
                messages=updated_messages,
                system=system_prompt
            )

            result = ""
            for content in final_response.content:
                if hasattr(content, "text"):
                    result += content.text
            return result

        return ""

    return analyze_market

# Usage
financial_agent = create_financial_agent()
analysis = financial_agent(["Bitcoin", "Ethereum", "Tesla"])
print(analysis)
```

## Model Selection

```python
# For speed and efficiency
response = anthropic_client.messages.create(
    model="claude-3-5-haiku-20241022",  # Fastest
    max_tokens=1000,
    tools=tools,
    messages=messages,
)

# For balanced performance (recommended)
response = anthropic_client.messages.create(
    model="claude-sonnet-4-20250514",  # Best balance
    max_tokens=1500,
    tools=tools,
    messages=messages,
)

# For complex reasoning tasks
response = anthropic_client.messages.create(
    model="claude-3-opus-20240229",  # Most capable
    max_tokens=2000,
    tools=tools,
    messages=messages,
)
```

## Search Parameters

Claude can automatically use advanced search parameters:

- **max_num_results**: Limit results (1-20, up to 100 with special API key)
- **included_sources**: Search specific domains or datasets
- **excluded_sources**: Exclude certain sources
- **category**: Guide search to specific topics
- **start_date/end_date**: Time-bounded searches
- **relevance_threshold**: Filter by relevance (0-1)

## Best Practices

### Use System Prompts

```python
system_prompt = """You are a research assistant with access to real-time information.

Guidelines:
- Always cite sources from search results
- Provide specific data points and numbers
- If information is recent, mention the date
- Do not use search operators (site:, OR, AND, quotes). Use natural keyword queries.
"""
```

## API Reference

### AnthropicProvider

```python
class AnthropicProvider:
    def __init__(self, valyu_api_key: Optional[str] = None):
        """Initialize provider. API key auto-detected from environment if not provided."""

    def get_tools(self) -> List[Dict]:
        """Get list of tools formatted for Anthropic Messages API."""

    def handle_tool_calls(self, response, modifiers=None) -> List[Dict]:
        """Execute tool calls from Anthropic response."""

    def build_conversation(self, input_messages, response, tool_results) -> List[Dict]:
        """Build updated message list with tool results."""
```

## Resources

- [Anthropic API Docs](https://docs.anthropic.com) - Official documentation
- [Valyu API Reference](https://docs.valyu.ai/api-reference) - Complete API documentation
- [Python SDK](https://docs.valyu.ai/sdk/python-sdk) - Full SDK documentation
- [Get API Key](https://platform.valyu.ai) - Sign up for free $10 credit
