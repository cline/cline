# LlamaIndex Query Engines Guide

Complete guide to query engines, modes, and customization.

## What are query engines?

Query engines power the retrieval and response generation in LlamaIndex:
1. Retrieve relevant chunks from index
2. Generate response using LLM + context
3. Return answer (optionally with sources)

## Basic query engine

```python
from llama_index.core import VectorStoreIndex

index = VectorStoreIndex.from_documents(documents)

# Default query engine
query_engine = index.as_query_engine()
response = query_engine.query("What is the main topic?")
print(response)
```

## Response modes

### 1. Compact (default) - Best for most cases

```python
query_engine = index.as_query_engine(
    response_mode="compact"
)

# Combines chunks that fit in context window
response = query_engine.query("Explain quantum computing")
```

### 2. Tree summarize - Hierarchical summarization

```python
query_engine = index.as_query_engine(
    response_mode="tree_summarize"
)

# Builds summary tree from chunks
# Best for: Summarization tasks, many retrieved chunks
response = query_engine.query("Summarize all the key findings")
```

### 3. Simple summarize - Concatenate and summarize

```python
query_engine = index.as_query_engine(
    response_mode="simple_summarize"
)

# Concatenates all chunks, then summarizes
# Fast but may lose context if too many chunks
```

### 4. Refine - Iterative refinement

```python
query_engine = index.as_query_engine(
    response_mode="refine"
)

# Refines answer iteratively across chunks
# Most thorough, slowest
# Best for: Complex questions requiring synthesis
```

### 5. No text - Return nodes only

```python
query_engine = index.as_query_engine(
    response_mode="no_text"
)

# Returns retrieved nodes without LLM response
# Useful for: Debugging retrieval, custom processing
response = query_engine.query("machine learning")
for node in response.source_nodes:
    print(node.text)
```

## Configuration options

### Similarity top-k

```python
# Return top 3 most similar chunks
query_engine = index.as_query_engine(
    similarity_top_k=3  # Default: 2
)
```

### Streaming

```python
# Stream response tokens
query_engine = index.as_query_engine(streaming=True)

response = query_engine.query("Explain neural networks")
for text in response.response_gen:
    print(text, end="", flush=True)
```

### Verbose mode

```python
# Show retrieval and generation process
query_engine = index.as_query_engine(verbose=True)

response = query_engine.query("What is Python?")
# Prints: Retrieved chunks, prompts, LLM calls
```

## Custom prompts

### Text QA template

```python
from llama_index.core import PromptTemplate

qa_prompt = PromptTemplate(
    "Context information is below.\n"
    "---------------------\n"
    "{context_str}\n"
    "---------------------\n"
    "Given the context, answer: {query_str}\n"
    "If the context doesn't contain the answer, say 'I don't know'.\n"
    "Answer: "
)

query_engine = index.as_query_engine(text_qa_template=qa_prompt)
```

### Refine template

```python
refine_prompt = PromptTemplate(
    "The original query is: {query_str}\n"
    "We have an existing answer: {existing_answer}\n"
    "We have new context: {context_msg}\n"
    "Refine the answer based on new context. "
    "If context isn't useful, return original answer.\n"
    "Refined Answer: "
)

query_engine = index.as_query_engine(
    response_mode="refine",
    refine_template=refine_prompt
)
```

## Node postprocessors

### Metadata filtering

```python
from llama_index.core.postprocessor import MetadataReplacementPostProcessor

postprocessor = MetadataReplacementPostProcessor(
    target_metadata_key="window"  # Replace node content with window
)

query_engine = index.as_query_engine(
    node_postprocessors=[postprocessor]
)
```

### Similarity cutoff

```python
from llama_index.core.postprocessor import SimilarityPostprocessor

# Filter nodes below similarity threshold
postprocessor = SimilarityPostprocessor(similarity_cutoff=0.7)

query_engine = index.as_query_engine(
    node_postprocessors=[postprocessor]
)
```

### Reranking

```python
from llama_index.core.postprocessor import SentenceTransformerRerank

# Rerank retrieved nodes
reranker = SentenceTransformerRerank(
    model="cross-encoder/ms-marco-MiniLM-L-2-v2",
    top_n=3
)

query_engine = index.as_query_engine(
    node_postprocessors=[reranker],
    similarity_top_k=10  # Retrieve 10, rerank to 3
)
```

## Advanced query engines

### Sub-question query engine

```python
from llama_index.core.query_engine import SubQuestionQueryEngine
from llama_index.core.tools import QueryEngineTool

# Multiple indices for different topics
python_index = VectorStoreIndex.from_documents(python_docs)
numpy_index = VectorStoreIndex.from_documents(numpy_docs)

# Create tools
python_tool = QueryEngineTool.from_defaults(
    query_engine=python_index.as_query_engine(),
    description="Useful for Python programming questions"
)
numpy_tool = QueryEngineTool.from_defaults(
    query_engine=numpy_index.as_query_engine(),
    description="Useful for NumPy array questions"
)

# Sub-question engine decomposes complex queries
query_engine = SubQuestionQueryEngine.from_defaults(
    query_engine_tools=[python_tool, numpy_tool]
)

# "How do I create numpy arrays in Python?" becomes:
# 1. Query numpy_tool about array creation
# 2. Query python_tool about syntax
# 3. Synthesize answers
response = query_engine.query("How do I create numpy arrays in Python?")
```

### Router query engine

```python
from llama_index.core.query_engine import RouterQueryEngine
from llama_index.core.selectors import LLMSingleSelector

# Route to appropriate index based on query
selector = LLMSingleSelector.from_defaults()

query_engine = RouterQueryEngine(
    selector=selector,
    query_engine_tools=[python_tool, numpy_tool]
)

# Automatically routes to correct index
response = query_engine.query("What is Python?")  # Routes to python_tool
response = query_engine.query("NumPy broadcasting?")  # Routes to numpy_tool
```

### Transform query engine

```python
from llama_index.core.query_engine import TransformQueryEngine
from llama_index.core.query_transforms import HyDEQueryTransform

# HyDE: Generate hypothetical document before retrieval
hyde_transform = HyDEQueryTransform(include_original=True)

query_engine = TransformQueryEngine(
    query_engine=base_query_engine,
    query_transform=hyde_transform
)

# Improves retrieval quality
response = query_engine.query("What are the benefits of Python?")
```

## Chat engine (conversational)

### Basic chat engine

```python
# Chat engine with memory
chat_engine = index.as_chat_engine(
    chat_mode="condense_plus_context"
)

# Multi-turn conversation
response1 = chat_engine.chat("What is Python?")
response2 = chat_engine.chat("What are its main features?")  # Remembers context
response3 = chat_engine.chat("Can you give examples?")
```

### Chat modes

```python
# 1. condense_plus_context (recommended)
chat_engine = index.as_chat_engine(chat_mode="condense_plus_context")
# Condenses chat history + retrieves relevant context

# 2. context - Simple RAG
chat_engine = index.as_chat_engine(chat_mode="context")
# Retrieves context for each query

# 3. react - Agent-based
chat_engine = index.as_chat_engine(chat_mode="react")
# Uses ReAct agent pattern with tools

# 4. best - Automatically selects best mode
chat_engine = index.as_chat_engine(chat_mode="best")
```

### Reset conversation

```python
# Clear chat history
chat_engine.reset()

# Start new conversation
response = chat_engine.chat("New topic: what is machine learning?")
```

## Structured output

### Pydantic models

```python
from pydantic import BaseModel
from llama_index.core.output_parsers import PydanticOutputParser

class Summary(BaseModel):
    title: str
    main_points: list[str]
    category: str

output_parser = PydanticOutputParser(output_cls=Summary)

query_engine = index.as_query_engine(
    output_parser=output_parser
)

response = query_engine.query("Summarize the document")
# response is a Pydantic model
print(response.title, response.main_points)
```

## Source tracking

### Get source nodes

```python
query_engine = index.as_query_engine()

response = query_engine.query("What is Python?")

# Access source nodes
for node in response.source_nodes:
    print(f"Text: {node.text}")
    print(f"Score: {node.score}")
    print(f"Metadata: {node.metadata}")
```

## Best practices

1. **Use compact mode for most cases** - Good balance
2. **Set similarity_top_k appropriately** - 2-5 usually optimal
3. **Enable streaming for long responses** - Better UX
4. **Add postprocessors for quality** - Reranking improves results
5. **Use chat engine for conversations** - Built-in memory
6. **Track source nodes** - Cite sources to users
7. **Custom prompts for domain** - Better responses
8. **Test different response modes** - Pick best for use case
9. **Monitor token usage** - Retrieval + generation costs
10. **Cache query engines** - Don't recreate each time

## Performance tips

### Caching

```python
from llama_index.core.storage.chat_store import SimpleChatStore

# Cache chat history
chat_store = SimpleChatStore()
chat_engine = index.as_chat_engine(
    chat_mode="condense_plus_context",
    chat_store=chat_store
)
```

### Async queries

```python
import asyncio

# Async query for concurrent requests
response = await query_engine.aquery("What is Python?")

# Multiple concurrent queries
responses = await asyncio.gather(
    query_engine.aquery("What is Python?"),
    query_engine.aquery("What is Java?")
)
```

## Resources

- **Query Engines Docs**: https://developers.llamaindex.ai/python/framework/modules/querying/
- **Response Modes**: https://developers.llamaindex.ai/python/framework/modules/querying/response_modes/
- **Chat Engines**: https://developers.llamaindex.ai/python/framework/modules/chat/
