# Google Gemini Integration

Valyu provides seamless integration with the Google Gemini API through function calling, enabling your Gemini models to access proprietary data sources, real-time web search, academic data sources, and financial data.

## Installation

```bash
pip install google-generativeai requests
```

Set your API keys:

```bash
export GOOGLE_API_KEY="your-google-api-key"
export VALYU_API_KEY="your-valyu-api-key"
```

## Basic Integration

### Function Definition

```python
import google.generativeai as genai
import requests
import json
import os
from typing import Literal

genai.configure(api_key=os.environ['GOOGLE_API_KEY'])

def valyu_search(
    query: str,
    search_type: Literal["all", "web", "proprietary", "news"] = "all",
    max_num_results: int = 5,
    relevance_threshold: float = 0.5,
    max_price: float = 30.0,
    category: str = None
) -> str:
    """Search for information using Valyu's comprehensive knowledge base."""
    url = "https://api.valyu.ai/v1/search"

    payload = {
        "query": query,
        "search_type": search_type,
        "max_num_results": max_num_results,
        "relevance_threshold": relevance_threshold,
        "max_price": max_price,
        "is_tool_call": True
    }

    if category:
        payload["category"] = category

    headers = {
        "Authorization": f"Bearer {os.environ['VALYU_API_KEY']}",
        "Content-Type": "application/json"
    }

    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return json.dumps(response.json(), indent=2)
    except Exception as e:
        return f"Search error: {str(e)}"

# Define the function declaration for Gemini
valyu_function_declaration = genai.protos.FunctionDeclaration(
    name="valyu_search",
    description="Search for real-time information, academic papers, and comprehensive knowledge using Valyu's database",
    parameters=genai.protos.Schema(
        type=genai.protos.Type.OBJECT,
        properties={
            "query": genai.protos.Schema(
                type=genai.protos.Type.STRING,
                description="Natural language search query"
            ),
            "search_type": genai.protos.Schema(
                type=genai.protos.Type.STRING,
                enum=["all", "web", "proprietary", "news"],
                description="Type of search"
            ),
            "max_num_results": genai.protos.Schema(
                type=genai.protos.Type.INTEGER,
                description="Number of results to return (1-20)"
            ),
            "relevance_threshold": genai.protos.Schema(
                type=genai.protos.Type.NUMBER,
                description="Minimum relevance score (0.0-1.0)"
            ),
            "max_price": genai.protos.Schema(
                type=genai.protos.Type.NUMBER,
                description="Maximum cost in dollars"
            ),
            "category": genai.protos.Schema(
                type=genai.protos.Type.STRING,
                description="Natural language category to guide search"
            )
        },
        required=["query"]
    )
)

valyu_tool = genai.protos.Tool(function_declarations=[valyu_function_declaration])

model = genai.GenerativeModel(
    model_name="gemini-2.0-flash-exp",
    tools=[valyu_tool]
)
```

### Basic Usage

```python
def chat_with_search(user_message: str):
    chat = model.start_chat()

    response = chat.send_message(
        f"You are a helpful assistant with access to real-time search. "
        f"Use the valyu_search function to find current information when needed. "
        f"User query: {user_message}"
    )

    if response.candidates[0].content.parts:
        for part in response.candidates[0].content.parts:
            if hasattr(part, 'function_call') and part.function_call:
                function_call = part.function_call

                if function_call.name == "valyu_search":
                    function_args = {}
                    for key, value in function_call.args.items():
                        function_args[key] = value

                    search_results = valyu_search(**function_args)

                    function_response = genai.protos.Part(
                        function_response=genai.protos.FunctionResponse(
                            name="valyu_search",
                            response={"result": search_results}
                        )
                    )

                    final_response = chat.send_message(function_response)
                    return final_response.text

    return response.text

# Example
result = chat_with_search("What are the latest developments in quantum computing?")
print(result)
```

## Multi-Turn Conversations

```python
class GeminiConversationWithSearch:
    def __init__(self):
        self.chat = model.start_chat()
        self.system_prompt = "You are a helpful research assistant with access to real-time search."

    def send_message(self, user_message: str):
        full_message = f"{self.system_prompt}\n\nUser: {user_message}"

        response = self.chat.send_message(full_message)

        if response.candidates[0].content.parts:
            for part in response.candidates[0].content.parts:
                if hasattr(part, 'function_call') and part.function_call:
                    function_call = part.function_call

                    if function_call.name == "valyu_search":
                        function_args = {}
                        for key, value in function_call.args.items():
                            function_args[key] = value

                        search_results = valyu_search(**function_args)

                        function_response = genai.protos.Part(
                            function_response=genai.protos.FunctionResponse(
                                name="valyu_search",
                                response={"result": search_results}
                            )
                        )

                        final_response = self.chat.send_message(function_response)
                        return final_response.text

        return response.text

# Usage
conversation = GeminiConversationWithSearch()
response1 = conversation.send_message("What are the latest developments in renewable energy?")
print(response1)

response2 = conversation.send_message("How do these compare to last year's progress?")
print(response2)
```

## Specialized Use Cases

### Financial Analysis Assistant

```python
def financial_analysis_gemini(query: str):
    financial_model = genai.GenerativeModel(
        model_name="gemini-2.0-flash-exp",
        tools=[valyu_tool],
        system_instruction="""You are a financial analyst with access to real-time market data and academic research.
        Use valyu_search with search_type='web' for current market news and
        search_type='proprietary' for academic financial research. Always provide data-driven insights."""
    )

    chat = financial_model.start_chat()
    response = chat.send_message(query)

    return process_gemini_response_with_functions(chat, response)
```

### Academic Research Assistant

```python
def academic_research_gemini(research_question: str):
    academic_model = genai.GenerativeModel(
        model_name="gemini-2.0-flash-exp",
        tools=[valyu_tool],
        system_instruction="""You are an academic research assistant. Focus on peer-reviewed sources and provide proper citations.
        Use the search tool to find relevant academic papers and synthesize the findings."""
    )

    chat = academic_model.start_chat()
    response = chat.send_message(research_question)

    return process_gemini_response_with_functions(chat, response)
```

## Gemini Models

Available Gemini 2.0 models:

- **`gemini-2.0-flash-exp`**: Latest experimental model with enhanced capabilities
- **`gemini-2.0-flash-thinking-exp`**: Model with enhanced reasoning capabilities
- **`gemini-1.5-pro`**: Production-ready model for complex tasks
- **`gemini-1.5-flash`**: Fast model for quick responses

## API Reference

### Function Parameters

- **`query`** (required): Natural language search query
- **`search_type`**: `"all"`, `"web"`, `"proprietary"`, or `"news"` (default: `"all"`)
- **`max_num_results`**: 1-20 results (default: 5)
- **`relevance_threshold`**: 0.0-1.0 relevance filter (default: 0.5)
- **`max_price`**: Maximum cost in CPM
- **`category`**: Natural language context guide

## Resources

- [Gemini Function Calling](https://ai.google.dev/docs/function_calling) - Official documentation
- [Valyu API Reference](https://docs.valyu.ai/api-reference) - Complete API documentation
- [Gemini Models](https://ai.google.dev/models) - Model capabilities
- [Get API Key](https://platform.valyu.ai) - Sign up for free $10 credit
