# OpenAI Integration

Integrate Valyu's deep search capabilities directly into your OpenAI applications using the provider system with OpenAI's **Responses API**. This enables your AI agents to access real-time information from academic papers, news, financial data, and authoritative sources.

## Installation

```bash
pip install valyu openai
```

Set your API keys:

```bash
export VALYU_API_KEY="your-valyu-api-key"
export OPENAI_API_KEY="your-openai-api-key"
```

## Basic Usage

The OpenAI provider handles the integration with the **Responses API**:

```python
from openai import OpenAI
from valyu import OpenAIProvider
from dotenv import load_dotenv

load_dotenv()

# Initialize clients
openai_client = OpenAI()
provider = OpenAIProvider()

# Get Valyu tools
tools = provider.get_tools()

# Create a research request
messages = [
    {
        "role": "user",
        "content": "What are the latest developments in quantum computing? Write a summary of your findings."
    }
]

# Step 1: Call OpenAI Responses API with tools
response = openai_client.responses.create(
    model="gpt-5",
    input=messages,
    tools=tools,
)

# Step 2: Execute tool calls
tool_results = provider.execute_tool_calls(response)

# Step 3: Get final response with search results
if tool_results:
    updated_messages = provider.build_conversation(messages, response, tool_results)
    final_response = openai_client.responses.create(
        model="gpt-5",
        input=updated_messages,
        tools=tools,
    )
    print(final_response.output_text)
else:
    print(response.output_text)
```

**Important**: This uses OpenAI's **Responses API** (`responses.create()`), not Chat Completions!

## How It Works

The `OpenAIProvider` handles everything:

1. **Tool Registration**: Automatically formats Valyu search for OpenAI Responses API
2. **Tool Execution**: Manages search API calls behind the scenes
3. **Conversation Flow**: Builds proper message sequences with tool results

## Research Agent Example

```python
from openai import OpenAI
from valyu import OpenAIProvider

def create_research_agent():
    client = OpenAI()
    provider = OpenAIProvider()
    tools = provider.get_tools()

    def research(query: str) -> str:
        messages = [
            {
                "role": "system",
                "content": "You are a research assistant with access to real-time information. Always cite your sources."
            },
            {
                "role": "user",
                "content": query
            }
        ]

        response = client.responses.create(
            model="gpt-5",
            input=messages,
            tools=tools,
        )

        tool_results = provider.execute_tool_calls(response)

        if tool_results:
            updated_messages = provider.build_conversation(messages, response, tool_results)
            final_response = client.responses.create(
                model="gpt-5",
                input=updated_messages,
                tools=tools,
            )
            return final_response.output_text

        return response.output_text

    return research

# Usage
agent = create_research_agent()
result = agent("Find the price of Bitcoin and Nvidia over the last 2 years")
print(result)
```

## Financial Analysis Example

```python
def create_financial_agent():
    client = OpenAI()
    provider = OpenAIProvider()
    tools = provider.get_tools()

    def analyze_market(assets: list) -> str:
        query = f"Get the latest news and price data for {', '.join(assets)}, then provide a detailed market analysis report"

        messages = [
            {
                "role": "system",
                "content": "You are a financial analyst. Provide data-driven insights with specific numbers and sources."
            },
            {
                "role": "user",
                "content": query
            }
        ]

        response = client.responses.create(
            model="gpt-5",
            input=messages,
            tools=tools,
        )

        tool_results = provider.execute_tool_calls(response)

        if tool_results:
            updated_messages = provider.build_conversation(messages, response, tool_results)
            final_response = client.responses.create(
                model="gpt-5",
                input=updated_messages,
                tools=tools,
            )
            return final_response.output_text

        return response.output_text

    return analyze_market

# Usage
financial_agent = create_financial_agent()
analysis = financial_agent(["Bitcoin", "Ethereum", "Tesla"])
print(analysis)
```

## Model Selection

```python
response = client.responses.create(
    model="gpt-5-mini",  # Faster, cheaper
    # model="gpt-5",      # More capable
    # model="o1-preview", # Advanced reasoning
    input=messages,
    tools=tools,
)
```

## Search Parameters

The AI model can automatically use advanced search parameters based on your query context:

- **max_num_results**: Limit results (1-20, up to 100 with special API key)
- **included_sources**: Search specific domains or datasets
- **excluded_sources**: Exclude certain sources
- **category**: Guide search to specific topics
- **start_date/end_date**: Time-bounded searches
- **relevance_threshold**: Filter by relevance (0-1)

## Best Practices

### Use Clear System Prompts

```python
messages = [
    {
        "role": "system",
        "content": """You are a research assistant with access to real-time information.

        Guidelines:
        - Always cite sources from search results
        - Provide specific data points and numbers
        - If information is recent, mention the date
        - Do not use search operators (site:, OR, AND, quotes). Use natural keyword queries.
        """
    },
    {
        "role": "user",
        "content": user_query
    }
]
```

### Multi-Turn Conversations

```python
class ResearchChat:
    def __init__(self):
        self.client = OpenAI()
        self.provider = OpenAIProvider()
        self.tools = self.provider.get_tools()
        self.messages = []

    def add_system_message(self, content: str):
        self.messages.append({"role": "system", "content": content})

    def chat(self, user_message: str) -> str:
        self.messages.append({"role": "user", "content": user_message})

        response = self.client.responses.create(
            model="gpt-5",
            input=self.messages,
            tools=self.tools,
        )

        tool_results = self.provider.execute_tool_calls(response)

        if tool_results:
            self.messages = self.provider.build_conversation(
                self.messages, response, tool_results
            )
            final_response = self.client.responses.create(
                model="gpt-5",
                input=self.messages,
                tools=self.tools,
            )
            assistant_message = final_response.output_text
        else:
            assistant_message = response.output_text

        self.messages.append({"role": "assistant", "content": assistant_message})
        return assistant_message

# Usage
chat = ResearchChat()
chat.add_system_message("You are a helpful research assistant.")
response = chat.chat("What's the latest news about renewable energy?")
```

## API Reference

### OpenAIProvider

```python
class OpenAIProvider:
    def __init__(self, valyu_api_key: Optional[str] = None):
        """Initialize provider. API key auto-detected from environment if not provided."""

    def get_tools(self) -> List[Dict]:
        """Get list of tools formatted for OpenAI Responses API."""

    def execute_tool_calls(self, response) -> List[Dict]:
        """Execute tool calls from OpenAI Responses API response."""

    def build_conversation(self, input_messages, response, tool_results) -> List[Dict]:
        """Build updated message list with tool results."""
```

## Resources

- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) - Official documentation
- [Valyu API Reference](https://docs.valyu.ai/api-reference) - Complete API documentation
- [Python SDK](https://docs.valyu.ai/sdk/python-sdk) - Full SDK documentation
- [Get API Key](https://platform.valyu.ai) - Sign up for free $10 credit
