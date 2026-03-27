# LlamaIndex Agents Guide

Building agents with tools and RAG capabilities.

## Basic agent

```python
from llama_index.core.agent import FunctionAgent
from llama_index.llms.openai import OpenAI

def multiply(a: int, b: int) -> int:
    """Multiply two numbers."""
    return a * b

llm = OpenAI(model="gpt-4o")
agent = FunctionAgent.from_tools(
    tools=[multiply],
    llm=llm,
    verbose=True
)

response = agent.chat("What is 25 * 17?")
```

## RAG agent

```python
from llama_index.core.tools import QueryEngineTool

# Create query engine as tool
index = VectorStoreIndex.from_documents(documents)

query_tool = QueryEngineTool.from_defaults(
    query_engine=index.as_query_engine(),
    name="python_docs",
    description="Useful for Python programming questions"
)

# Agent with RAG + calculator
agent = FunctionAgent.from_tools(
    tools=[query_tool, multiply],
    llm=llm
)

response = agent.chat("According to the docs, what is Python?")
```

## Multi-document agent

```python
# Multiple knowledge bases
python_tool = QueryEngineTool.from_defaults(
    query_engine=python_index.as_query_engine(),
    name="python_docs",
    description="Python programming documentation"
)

numpy_tool = QueryEngineTool.from_defaults(
    query_engine=numpy_index.as_query_engine(),
    name="numpy_docs",
    description="NumPy array documentation"
)

agent = FunctionAgent.from_tools(
    tools=[python_tool, numpy_tool],
    llm=llm
)

# Agent chooses correct knowledge base
response = agent.chat("How do I create numpy arrays?")
```

## Best practices

1. **Clear tool descriptions** - Agent needs to know when to use each tool
2. **Limit tools to 5-10** - Too many confuses agent
3. **Use verbose mode during dev** - See agent reasoning
4. **Combine RAG + calculation** - Powerful combination
5. **Test tool combinations** - Ensure they work together

## Resources

- **Agents Docs**: https://developers.llamaindex.ai/python/framework/modules/agents/
