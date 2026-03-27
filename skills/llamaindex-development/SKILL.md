---
name: llamaindex-development
description: Expert guidance for LlamaIndex development including RAG applications, vector stores, document processing, query engines, and building production AI applications.
---

# LlamaIndex Development

You are an expert in LlamaIndex for building RAG (Retrieval-Augmented Generation) applications, data indexing, and LLM-powered applications with Python.

## Key Principles

- Write concise, technical responses with accurate Python examples
- Use functional, declarative programming; avoid classes where possible
- Prioritize code quality, maintainability, and performance
- Use descriptive variable names that reflect their purpose
- Follow PEP 8 style guidelines

## Code Organization

### Directory Structure

```
project/
├── data/                 # Source documents and data
├── indexes/              # Persisted index storage
├── loaders/              # Custom document loaders
├── retrievers/           # Custom retriever implementations
├── query_engines/        # Query engine configurations
├── prompts/              # Custom prompt templates
├── transformations/      # Document transformations
├── callbacks/            # Custom callback handlers
├── utils/                # Utility functions
├── tests/                # Test files
└── config/               # Configuration files
```

### Naming Conventions

- Use snake_case for files, functions, and variables
- Use PascalCase for classes
- Prefix private functions with underscore
- Use descriptive names (e.g., `create_vector_index`, `build_query_engine`)

## Document Loading

### Using Document Loaders

```python
from llama_index.core import SimpleDirectoryReader
from llama_index.readers.file import PDFReader, DocxReader

# Load from directory
documents = SimpleDirectoryReader(
    input_dir="./data",
    recursive=True,
    required_exts=[".pdf", ".txt", ".md"]
).load_data()

# Load specific file types
pdf_reader = PDFReader()
documents = pdf_reader.load_data(file="document.pdf")
```

### Custom Loaders

```python
from llama_index.core.readers.base import BaseReader
from llama_index.core import Document

class CustomLoader(BaseReader):
    def load_data(self, file_path: str) -> list[Document]:
        # Custom loading logic
        with open(file_path, 'r') as f:
            content = f.read()

        return [Document(
            text=content,
            metadata={"source": file_path}
        )]
```

## Text Splitting and Processing

### Node Parsing

```python
from llama_index.core.node_parser import (
    SentenceSplitter,
    SemanticSplitterNodeParser,
    MarkdownNodeParser
)

# Simple sentence splitting
splitter = SentenceSplitter(
    chunk_size=1024,
    chunk_overlap=200
)
nodes = splitter.get_nodes_from_documents(documents)

# Semantic splitting (preserves meaning)
from llama_index.embeddings.openai import OpenAIEmbedding

semantic_splitter = SemanticSplitterNodeParser(
    embed_model=OpenAIEmbedding(),
    breakpoint_percentile_threshold=95
)

# Markdown-aware splitting
markdown_splitter = MarkdownNodeParser()
```

### Best Practices for Chunking

- Choose chunk size based on your embedding model's context window
- Use overlap to maintain context between chunks
- Preserve document structure when possible
- Include metadata for filtering and retrieval
- Use semantic splitting for better coherence

## Vector Stores and Indexing

### Creating Indexes

```python
from llama_index.core import VectorStoreIndex, StorageContext
from llama_index.vector_stores.chroma import ChromaVectorStore
import chromadb

# In-memory index
index = VectorStoreIndex.from_documents(documents)

# With persistent vector store
chroma_client = chromadb.PersistentClient(path="./chroma_db")
chroma_collection = chroma_client.get_or_create_collection("my_collection")

vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
storage_context = StorageContext.from_defaults(vector_store=vector_store)

index = VectorStoreIndex.from_documents(
    documents,
    storage_context=storage_context
)
```

### Supported Vector Stores

- Chroma (local development)
- Pinecone (production, managed)
- Weaviate (production, self-hosted or managed)
- Qdrant (production, self-hosted or managed)
- PostgreSQL with pgvector
- MongoDB Atlas Vector Search

### Index Persistence

```python
from llama_index.core import StorageContext, load_index_from_storage

# Persist index
index.storage_context.persist(persist_dir="./storage")

# Load index
storage_context = StorageContext.from_defaults(persist_dir="./storage")
index = load_index_from_storage(storage_context)
```

## Query Engines

### Basic Query Engine

```python
from llama_index.core import VectorStoreIndex

index = VectorStoreIndex.from_documents(documents)
query_engine = index.as_query_engine(
    similarity_top_k=5,
    response_mode="compact"
)

response = query_engine.query("What is the main topic?")
print(response.response)
```

### Response Modes

- `refine`: Iteratively refine answer through each node
- `compact`: Combine chunks before sending to LLM
- `tree_summarize`: Build tree and summarize
- `simple_summarize`: Truncate and summarize
- `accumulate`: Accumulate responses from each node

### Advanced Query Engine

```python
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core.postprocessor import SimilarityPostprocessor

query_engine = RetrieverQueryEngine.from_args(
    retriever=index.as_retriever(similarity_top_k=10),
    node_postprocessors=[
        SimilarityPostprocessor(similarity_cutoff=0.7)
    ],
    response_mode="compact"
)
```

## Retrievers

### Custom Retrievers

```python
from llama_index.core.retrievers import VectorIndexRetriever

# Basic retriever
retriever = VectorIndexRetriever(
    index=index,
    similarity_top_k=10
)

# Retrieve nodes
nodes = retriever.retrieve("search query")
```

### Hybrid Search

```python
from llama_index.core.retrievers import QueryFusionRetriever

# Combine multiple retrieval strategies
retriever = QueryFusionRetriever(
    [
        index.as_retriever(similarity_top_k=5),
        bm25_retriever,  # Keyword-based
    ],
    num_queries=4,
    use_async=True
)
```

## Embeddings

### Embedding Models

```python
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core import Settings

# OpenAI embeddings
Settings.embed_model = OpenAIEmbedding(
    model="text-embedding-3-small",
    dimensions=512  # Optional dimension reduction
)

# Local embeddings
Settings.embed_model = HuggingFaceEmbedding(
    model_name="BAAI/bge-small-en-v1.5"
)
```

## LLM Configuration

### Setting Up LLMs

```python
from llama_index.llms.openai import OpenAI
from llama_index.llms.anthropic import Anthropic
from llama_index.core import Settings

# OpenAI
Settings.llm = OpenAI(
    model="gpt-4o",
    temperature=0.1
)

# Anthropic
Settings.llm = Anthropic(
    model="claude-sonnet-4-20250514",
    temperature=0.1
)
```

## Agents

### Building Agents

```python
from llama_index.core.agent import ReActAgent
from llama_index.core.tools import QueryEngineTool, ToolMetadata

# Create tools from query engines
tools = [
    QueryEngineTool(
        query_engine=documents_query_engine,
        metadata=ToolMetadata(
            name="documents",
            description="Search through documents"
        )
    ),
    QueryEngineTool(
        query_engine=code_query_engine,
        metadata=ToolMetadata(
            name="codebase",
            description="Search through code"
        )
    )
]

# Create agent
agent = ReActAgent.from_tools(
    tools,
    llm=llm,
    verbose=True
)

response = agent.chat("Find information about X")
```

## Performance Optimization

### Caching

```python
from llama_index.core import Settings
from llama_index.core.llms import LLMCache

# Enable LLM response caching
Settings.llm = OpenAI(model="gpt-4o")
Settings.llm_cache = LLMCache()
```

### Async Operations

```python
# Use async for better performance
response = await query_engine.aquery("question")

# Batch processing
responses = await asyncio.gather(*[
    query_engine.aquery(q) for q in questions
])
```

### Embedding Optimization

- Batch embeddings when possible
- Use smaller embedding dimensions when accuracy allows
- Cache embeddings for repeated documents
- Use local models for cost-sensitive applications

## Error Handling

```python
from llama_index.core.callbacks import CallbackManager, LlamaDebugHandler

# Debug handler for troubleshooting
debug_handler = LlamaDebugHandler()
callback_manager = CallbackManager([debug_handler])

Settings.callback_manager = callback_manager
```

## Testing

- Unit test document loaders and transformations
- Test retrieval quality with known queries
- Validate index persistence and loading
- Test query engine responses
- Monitor retrieval metrics (precision, recall)

## Dependencies

- llama-index
- llama-index-embeddings-openai
- llama-index-llms-openai
- llama-index-vector-stores-chroma
- chromadb
- python-dotenv
- pydantic
