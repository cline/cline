---
name: llamaindex
description: Data framework for building LLM applications with RAG. Specializes in document ingestion (300+ connectors), indexing, and querying. Features vector indices, query engines, agents, and multi-modal support. Use for document Q&A, chatbots, knowledge retrieval, or building RAG pipelines. Best for data-centric LLM applications.
version: 1.0.0
author: Orchestra Research
license: MIT
tags: [Agents, LlamaIndex, RAG, Document Ingestion, Vector Indices, Query Engines, Knowledge Retrieval, Data Framework, Multimodal, Private Data, Connectors]
dependencies: [llama-index, openai, anthropic]
---

# LlamaIndex - Data Framework for LLM Applications

The leading framework for connecting LLMs with your data.

## When to use LlamaIndex

**Use LlamaIndex when:**
- Building RAG (retrieval-augmented generation) applications
- Need document question-answering over private data
- Ingesting data from multiple sources (300+ connectors)
- Creating knowledge bases for LLMs
- Building chatbots with enterprise data
- Need structured data extraction from documents

**Metrics**:
- **45,100+ GitHub stars**
- **23,000+ repositories** use LlamaIndex
- **300+ data connectors** (LlamaHub)
- **1,715+ contributors**
- **v0.14.7** (stable)

**Use alternatives instead**:
- **LangChain**: More general-purpose, better for agents
- **Haystack**: Production search pipelines
- **txtai**: Lightweight semantic search
- **Chroma**: Just need vector storage

## Quick start

### Installation

```bash
# Starter package (recommended)
pip install llama-index

# Or minimal core + specific integrations
pip install llama-index-core
pip install llama-index-llms-openai
pip install llama-index-embeddings-openai
```

### 5-line RAG example

```python
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader

# Load documents
documents = SimpleDirectoryReader("data").load_data()

# Create index
index = VectorStoreIndex.from_documents(documents)

# Query
query_engine = index.as_query_engine()
response = query_engine.query("What did the author do growing up?")
print(response)
```

## Core concepts

### 1. Data connectors - Load documents

```python
from llama_index.core import SimpleDirectoryReader, Document
from llama_index.readers.web import SimpleWebPageReader
from llama_index.readers.github import GithubRepositoryReader

# Directory of files
documents = SimpleDirectoryReader("./data").load_data()

# Web pages
reader = SimpleWebPageReader()
documents = reader.load_data(["https://example.com"])

# GitHub repository
reader = GithubRepositoryReader(owner="user", repo="repo")
documents = reader.load_data(branch="main")

# Manual document creation
doc = Document(
    text="This is the document content",
    metadata={"source": "manual", "date": "2025-01-01"}
)
```

### 2. Indices - Structure data

```python
from llama_index.core import VectorStoreIndex, ListIndex, TreeIndex

# Vector index (most common - semantic search)
vector_index = VectorStoreIndex.from_documents(documents)

# List index (sequential scan)
list_index = ListIndex.from_documents(documents)

# Tree index (hierarchical summary)
tree_index = TreeIndex.from_documents(documents)

# Save index
index.storage_context.persist(persist_dir="./storage")

# Load index
from llama_index.core import load_index_from_storage, StorageContext
storage_context = StorageContext.from_defaults(persist_dir="./storage")
index = load_index_from_storage(storage_context)
```

### 3. Query engines - Ask questions

```python
# Basic query
query_engine = index.as_query_engine()
response = query_engine.query("What is the main topic?")
print(response)

# Streaming response
query_engine = index.as_query_engine(streaming=True)
response = query_engine.query("Explain quantum computing")
for text in response.response_gen:
    print(text, end="", flush=True)

# Custom configuration
query_engine = index.as_query_engine(
    similarity_top_k=3,          # Return top 3 chunks
    response_mode="compact",     # Or "tree_summarize", "simple_summarize"
    verbose=True
)
```

### 4. Retrievers - Find relevant chunks

```python
# Vector retriever
retriever = index.as_retriever(similarity_top_k=5)
nodes = retriever.retrieve("machine learning")

# With filtering
retriever = index.as_retriever(
    similarity_top_k=3,
    filters={"metadata.category": "tutorial"}
)

# Custom retriever
from llama_index.core.retrievers import BaseRetriever

class CustomRetriever(BaseRetriever):
    def _retrieve(self, query_bundle):
        # Your custom retrieval logic
        return nodes
```

## Agents with tools

### Basic agent

```python
from llama_index.core.agent import FunctionAgent
from llama_index.llms.openai import OpenAI

# Define tools
def multiply(a: int, b: int) -> int:
    """Multiply two numbers."""
    return a * b

def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

# Create agent
llm = OpenAI(model="gpt-4o")
agent = FunctionAgent.from_tools(
    tools=[multiply, add],
    llm=llm,
    verbose=True
)

# Use agent
response = agent.chat("What is 25 * 17 + 142?")
print(response)
```

### RAG agent (document search + tools)

```python
from llama_index.core.tools import QueryEngineTool

# Create index as before
index = VectorStoreIndex.from_documents(documents)

# Wrap query engine as tool
query_tool = QueryEngineTool.from_defaults(
    query_engine=index.as_query_engine(),
    name="python_docs",
    description="Useful for answering questions about Python programming"
)

# Agent with document search + calculator
agent = FunctionAgent.from_tools(
    tools=[query_tool, multiply, add],
    llm=llm
)

# Agent decides when to search docs vs calculate
response = agent.chat("According to the docs, what is Python used for?")
```

## Advanced RAG patterns

### Chat engine (conversational)

```python
from llama_index.core.chat_engine import CondensePlusContextChatEngine

# Chat with memory
chat_engine = index.as_chat_engine(
    chat_mode="condense_plus_context",  # Or "context", "react"
    verbose=True
)

# Multi-turn conversation
response1 = chat_engine.chat("What is Python?")
response2 = chat_engine.chat("Can you give examples?")  # Remembers context
response3 = chat_engine.chat("What about web frameworks?")
```

### Metadata filtering

```python
from llama_index.core.vector_stores import MetadataFilters, ExactMatchFilter

# Filter by metadata
filters = MetadataFilters(
    filters=[
        ExactMatchFilter(key="category", value="tutorial"),
        ExactMatchFilter(key="difficulty", value="beginner")
    ]
)

retriever = index.as_retriever(
    similarity_top_k=3,
    filters=filters
)

query_engine = index.as_query_engine(filters=filters)
```

### Structured output

```python
from pydantic import BaseModel
from llama_index.core.output_parsers import PydanticOutputParser

class Summary(BaseModel):
    title: str
    main_points: list[str]
    conclusion: str

# Get structured response
output_parser = PydanticOutputParser(output_cls=Summary)
query_engine = index.as_query_engine(output_parser=output_parser)

response = query_engine.query("Summarize the document")
summary = response  # Pydantic model
print(summary.title, summary.main_points)
```

## Data ingestion patterns

### Multiple file types

```python
# Load all supported formats
documents = SimpleDirectoryReader(
    "./data",
    recursive=True,
    required_exts=[".pdf", ".docx", ".txt", ".md"]
).load_data()
```

### Web scraping

```python
from llama_index.readers.web import BeautifulSoupWebReader

reader = BeautifulSoupWebReader()
documents = reader.load_data(urls=[
    "https://docs.python.org/3/tutorial/",
    "https://docs.python.org/3/library/"
])
```

### Database

```python
from llama_index.readers.database import DatabaseReader

reader = DatabaseReader(
    sql_database_uri="postgresql://user:pass@localhost/db"
)
documents = reader.load_data(query="SELECT * FROM articles")
```

### API endpoints

```python
from llama_index.readers.json import JSONReader

reader = JSONReader()
documents = reader.load_data("https://api.example.com/data.json")
```

## Vector store integrations

### Chroma (local)

```python
from llama_index.vector_stores.chroma import ChromaVectorStore
import chromadb

# Initialize Chroma
db = chromadb.PersistentClient(path="./chroma_db")
collection = db.get_or_create_collection("my_collection")

# Create vector store
vector_store = ChromaVectorStore(chroma_collection=collection)

# Use in index
from llama_index.core import StorageContext
storage_context = StorageContext.from_defaults(vector_store=vector_store)
index = VectorStoreIndex.from_documents(documents, storage_context=storage_context)
```

### Pinecone (cloud)

```python
from llama_index.vector_stores.pinecone import PineconeVectorStore
import pinecone

# Initialize Pinecone
pinecone.init(api_key="your-key", environment="us-west1-gcp")
pinecone_index = pinecone.Index("my-index")

# Create vector store
vector_store = PineconeVectorStore(pinecone_index=pinecone_index)
storage_context = StorageContext.from_defaults(vector_store=vector_store)

index = VectorStoreIndex.from_documents(documents, storage_context=storage_context)
```

### FAISS (fast)

```python
from llama_index.vector_stores.faiss import FaissVectorStore
import faiss

# Create FAISS index
d = 1536  # Dimension of embeddings
faiss_index = faiss.IndexFlatL2(d)

vector_store = FaissVectorStore(faiss_index=faiss_index)
storage_context = StorageContext.from_defaults(vector_store=vector_store)

index = VectorStoreIndex.from_documents(documents, storage_context=storage_context)
```

## Customization

### Custom LLM

```python
from llama_index.llms.anthropic import Anthropic
from llama_index.core import Settings

# Set global LLM
Settings.llm = Anthropic(model="claude-sonnet-4-5-20250929")

# Now all queries use Anthropic
query_engine = index.as_query_engine()
```

### Custom embeddings

```python
from llama_index.embeddings.huggingface import HuggingFaceEmbedding

# Use HuggingFace embeddings
Settings.embed_model = HuggingFaceEmbedding(
    model_name="sentence-transformers/all-mpnet-base-v2"
)

index = VectorStoreIndex.from_documents(documents)
```

### Custom prompt templates

```python
from llama_index.core import PromptTemplate

qa_prompt = PromptTemplate(
    "Context: {context_str}\n"
    "Question: {query_str}\n"
    "Answer the question based only on the context. "
    "If the answer is not in the context, say 'I don't know'.\n"
    "Answer: "
)

query_engine = index.as_query_engine(text_qa_template=qa_prompt)
```

## Multi-modal RAG

### Image + text

```python
from llama_index.core import SimpleDirectoryReader
from llama_index.multi_modal_llms.openai import OpenAIMultiModal

# Load images and documents
documents = SimpleDirectoryReader(
    "./data",
    required_exts=[".jpg", ".png", ".pdf"]
).load_data()

# Multi-modal index
index = VectorStoreIndex.from_documents(documents)

# Query with multi-modal LLM
multi_modal_llm = OpenAIMultiModal(model="gpt-4o")
query_engine = index.as_query_engine(llm=multi_modal_llm)

response = query_engine.query("What is in the diagram on page 3?")
```

## Evaluation

### Response quality

```python
from llama_index.core.evaluation import RelevancyEvaluator, FaithfulnessEvaluator

# Evaluate relevance
relevancy = RelevancyEvaluator()
result = relevancy.evaluate_response(
    query="What is Python?",
    response=response
)
print(f"Relevancy: {result.passing}")

# Evaluate faithfulness (no hallucination)
faithfulness = FaithfulnessEvaluator()
result = faithfulness.evaluate_response(
    query="What is Python?",
    response=response
)
print(f"Faithfulness: {result.passing}")
```

## Best practices

1. **Use vector indices for most cases** - Best performance
2. **Save indices to disk** - Avoid re-indexing
3. **Chunk documents properly** - 512-1024 tokens optimal
4. **Add metadata** - Enables filtering and tracking
5. **Use streaming** - Better UX for long responses
6. **Enable verbose during dev** - See retrieval process
7. **Evaluate responses** - Check relevance and faithfulness
8. **Use chat engine for conversations** - Built-in memory
9. **Persist storage** - Don't lose your index
10. **Monitor costs** - Track embedding and LLM usage

## Common patterns

### Document Q&A system

```python
# Complete RAG pipeline
documents = SimpleDirectoryReader("docs").load_data()
index = VectorStoreIndex.from_documents(documents)
index.storage_context.persist(persist_dir="./storage")

# Query
query_engine = index.as_query_engine(
    similarity_top_k=3,
    response_mode="compact",
    verbose=True
)
response = query_engine.query("What is the main topic?")
print(response)
print(f"Sources: {[node.metadata['file_name'] for node in response.source_nodes]}")
```

### Chatbot with memory

```python
# Conversational interface
chat_engine = index.as_chat_engine(
    chat_mode="condense_plus_context",
    verbose=True
)

# Multi-turn chat
while True:
    user_input = input("You: ")
    if user_input.lower() == "quit":
        break
    response = chat_engine.chat(user_input)
    print(f"Bot: {response}")
```

## Performance benchmarks

| Operation | Latency | Notes |
|-----------|---------|-------|
| Index 100 docs | ~10-30s | One-time, can persist |
| Query (vector) | ~0.5-2s | Retrieval + LLM |
| Streaming query | ~0.5s first token | Better UX |
| Agent with tools | ~3-8s | Multiple tool calls |

## LlamaIndex vs LangChain

| Feature | LlamaIndex | LangChain |
|---------|------------|-----------|
| **Best for** | RAG, document Q&A | Agents, general LLM apps |
| **Data connectors** | 300+ (LlamaHub) | 100+ |
| **RAG focus** | Core feature | One of many |
| **Learning curve** | Easier for RAG | Steeper |
| **Customization** | High | Very high |
| **Documentation** | Excellent | Good |

**Use LlamaIndex when:**
- Your primary use case is RAG
- Need many data connectors
- Want simpler API for document Q&A
- Building knowledge retrieval system

**Use LangChain when:**
- Building complex agents
- Need more general-purpose tools
- Want more flexibility
- Complex multi-step workflows

## References

- **[Query Engines Guide](references/query_engines.md)** - Query modes, customization, streaming
- **[Agents Guide](references/agents.md)** - Tool creation, RAG agents, multi-step reasoning
- **[Data Connectors Guide](references/data_connectors.md)** - 300+ connectors, custom loaders

## Resources

- **GitHub**: https://github.com/run-llama/llama_index ⭐ 45,100+
- **Docs**: https://developers.llamaindex.ai/python/framework/
- **LlamaHub**: https://llamahub.ai (data connectors)
- **LlamaCloud**: https://cloud.llamaindex.ai (enterprise)
- **Discord**: https://discord.gg/dGcwcsnxhU
- **Version**: 0.14.7+
- **License**: MIT


