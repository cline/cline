---
name: langchain-rag
description: "INVOKE THIS SKILL when building ANY retrieval-augmented generation (RAG) system. Covers document loaders, RecursiveCharacterTextSplitter, embeddings (OpenAI), and vector stores (Chroma, FAISS, Pinecone)."
---

<overview>
Retrieval Augmented Generation (RAG) enhances LLM responses by fetching relevant context from external knowledge sources.

**Pipeline:**
1. **Index**: Load → Split → Embed → Store
2. **Retrieve**: Query → Embed → Search → Return docs
3. **Generate**: Docs + Query → LLM → Response

**Key Components:**
- **Document Loaders**: Ingest data from files, web, databases
- **Text Splitters**: Break documents into chunks
- **Embeddings**: Convert text to vectors
- **Vector Stores**: Store and search embeddings
</overview>

<vectorstore-selection>

| Vector Store | Use Case | Persistence |
|--------------|----------|-------------|
| **InMemory** | Testing | Memory only |
| **FAISS** | Local, high performance | Disk |
| **Chroma** | Development | Disk |
| **Pinecone** | Production, managed | Cloud |

</vectorstore-selection>

---

## Complete RAG Pipeline

<ex-basic-rag-setup>
<python>
End-to-end RAG pipeline: load documents, split into chunks, embed, store, retrieve, and generate a response.
```python
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_community.vectorstores import InMemoryVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

# 1. Load documents
docs = [
    Document(page_content="LangChain is a framework for LLM apps.", metadata={}),
    Document(page_content="RAG = Retrieval Augmented Generation.", metadata={}),
]

# 2. Split documents
splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
splits = splitter.split_documents(docs)

# 3. Create embeddings and store
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
vectorstore = InMemoryVectorStore.from_documents(splits, embeddings)

# 4. Create retriever
retriever = vectorstore.as_retriever(search_kwargs={"k": 4})

# 5. Use in RAG
model = ChatOpenAI(model="gpt-4.1")
query = "What is RAG?"
relevant_docs = retriever.invoke(query)

context = "\n\n".join([doc.page_content for doc in relevant_docs])
response = model.invoke([
    {"role": "system", "content": f"Use this context:\n\n{context}"},
    {"role": "user", "content": query},
])
```
</python>
<typescript>
End-to-end RAG pipeline: load documents, split into chunks, embed, store, retrieve, and generate a response.
```typescript
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";

// 1. Load documents
const docs = [
  new Document({ pageContent: "LangChain is a framework for LLM apps.", metadata: {} }),
  new Document({ pageContent: "RAG = Retrieval Augmented Generation.", metadata: {} }),
];

// 2. Split documents
const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 });
const splits = await splitter.splitDocuments(docs);

// 3. Create embeddings and store
const embeddings = new OpenAIEmbeddings({ model: "text-embedding-3-small" });
const vectorstore = await MemoryVectorStore.fromDocuments(splits, embeddings);

// 4. Create retriever
const retriever = vectorstore.asRetriever({ k: 4 });

// 5. Use in RAG
const model = new ChatOpenAI({ model: "gpt-4.1" });
const query = "What is RAG?";
const relevantDocs = await retriever.invoke(query);

const context = relevantDocs.map(doc => doc.pageContent).join("\n\n");
const response = await model.invoke([
  { role: "system", content: `Use this context:\n\n${context}` },
  { role: "user", content: query },
]);
```
</typescript>
</ex-basic-rag-setup>

---

## Document Loaders

<ex-loading-pdf>
<python>
Load a PDF file and extract each page as a separate document.
```python
from langchain_community.document_loaders import PyPDFLoader

loader = PyPDFLoader("./document.pdf")
docs = loader.load()
print(f"Loaded {len(docs)} pages")
```
</python>
<typescript>
Load a PDF file and extract each page as a separate document.
```typescript
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";

const loader = new PDFLoader("./document.pdf");
const docs = await loader.load();
console.log(`Loaded ${docs.length} pages`);
```
</typescript>
</ex-loading-pdf>

<ex-loading-web-pages>
<python>
Fetch and parse content from a web URL into a document.
```python
from langchain_community.document_loaders import WebBaseLoader

loader = WebBaseLoader("https://docs.langchain.com")
docs = loader.load()
```
</python>
<typescript>
Fetch and parse content from a web URL into a document using Cheerio.
```typescript
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";

const loader = new CheerioWebBaseLoader("https://docs.langchain.com");
const docs = await loader.load();
```
</typescript>
</ex-loading-web-pages>

<ex-loading-directory>
<python>
Load all text files from a directory using a glob pattern.
```python
from langchain_community.document_loaders import DirectoryLoader, TextLoader

# Load all text files from directory
loader = DirectoryLoader(
    "path/to/documents",
    glob="**/*.txt",  # Pattern for files to load
    loader_cls=TextLoader
)
docs = loader.load()
```
</python>
</ex-loading-directory>

---

## Text Splitting

<ex-text-splitting>
<python>
Split documents into chunks using RecursiveCharacterTextSplitter with configurable size and overlap.
```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,        # Characters per chunk
    chunk_overlap=200,      # Overlap for context continuity
    separators=["\n\n", "\n", " ", ""],  # Split hierarchy
)

splits = splitter.split_documents(docs)
```
</python>
</ex-text-splitting>

---

## Vector Stores

<ex-chroma-vectorstore>
<python>
Create a persistent Chroma vector store and reload it from disk.
```python
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings

vectorstore = Chroma.from_documents(
    documents=splits,
    embedding=OpenAIEmbeddings(),
    persist_directory="./chroma_db",
    collection_name="my-collection",
)

# Load existing
vectorstore = Chroma(
    persist_directory="./chroma_db",
    embedding_function=OpenAIEmbeddings(),
    collection_name="my-collection",
)
```
</python>
<typescript>
Create a Chroma vector store connected to a running Chroma server.
```typescript
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OpenAIEmbeddings } from "@langchain/openai";

const vectorstore = await Chroma.fromDocuments(
  splits,
  new OpenAIEmbeddings(),
  { collectionName: "my-collection", url: "http://localhost:8000" }
);
```
</typescript>
</ex-chroma-vectorstore>

<ex-faiss-vectorstore>
<python>
Create a FAISS vector store, save it to disk, and reload it.
```python
from langchain_community.vectorstores import FAISS

vectorstore = FAISS.from_documents(splits, embeddings)
vectorstore.save_local("./faiss_index")

# Load (requires allow_dangerous_deserialization)
loaded = FAISS.load_local(
    "./faiss_index",
    embeddings,
    allow_dangerous_deserialization=True
)
```
</python>
<typescript>
Create a FAISS vector store, save it to disk, and reload it.
```typescript
import { FaissStore } from "@langchain/community/vectorstores/faiss";

const vectorstore = await FaissStore.fromDocuments(splits, embeddings);
await vectorstore.save("./faiss_index");

const loaded = await FaissStore.load("./faiss_index", embeddings);
```
</typescript>
</ex-faiss-vectorstore>

---

## Retrieval

<ex-similarity-search>
<python>
Perform similarity search and retrieve results with relevance scores.
```python
# Basic search
results = vectorstore.similarity_search(query, k=5)

# With scores
results_with_score = vectorstore.similarity_search_with_score(query, k=5)
for doc, score in results_with_score:
    print(f"Score: {score}, Content: {doc.page_content}")
```
</python>
<typescript>
Perform similarity search and retrieve results with relevance scores.
```typescript
// Basic search
const results = await vectorstore.similaritySearch(query, 5);

// With scores
const resultsWithScore = await vectorstore.similaritySearchWithScore(query, 5);
for (const [doc, score] of resultsWithScore) {
  console.log(`Score: ${score}, Content: ${doc.pageContent}`);
}
```
</typescript>
</ex-similarity-search>

<ex-mmr-search>
<python>
Use MMR (Maximal Marginal Relevance) to balance relevance and diversity in search results.
```python
# MMR balances relevance and diversity
retriever = vectorstore.as_retriever(
    search_type="mmr",
    search_kwargs={"fetch_k": 20, "lambda_mult": 0.5, "k": 5},
)
```
</python>
</ex-mmr-search>

<ex-metadata-filtering>
<python>
Add metadata to documents and filter search results by metadata properties.
```python
# Add metadata when creating documents
docs = [
    Document(
        page_content="Python programming guide",
        metadata={"language": "python", "topic": "programming"}
    ),
]

# Search with filter
results = vectorstore.similarity_search(
    "programming",
    k=5,
    filter={"language": "python"}  # Only Python docs
)
```
</python>
</ex-metadata-filtering>

<ex-rag-with-agent>
<python>
Create an agent that uses RAG as a tool for answering questions.
```python
from langchain.agents import create_agent
from langchain.tools import tool

@tool
def search_docs(query: str) -> str:
    """Search documentation for relevant information."""
    docs = retriever.invoke(query)
    return "\n\n".join([d.page_content for d in docs])

agent = create_agent(
    model="gpt-4.1",
    tools=[search_docs],
)

result = agent.invoke({
    "messages": [{"role": "user", "content": "How do I create an agent?"}]
})
```
</python>
<typescript>
Create an agent that uses RAG as a tool for answering questions.
```typescript
import { createAgent } from "langchain";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const searchDocs = tool(
  async (input) => {
    const docs = await retriever.invoke(input.query);
    return docs.map(d => d.pageContent).join("\n\n");
  },
  {
    name: "search_docs",
    description: "Search documentation for relevant information.",
    schema: z.object({ query: z.string() }),
  }
);

const agent = createAgent({
  model: "gpt-4.1",
  tools: [searchDocs],
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "How do I create an agent?" }],
});
```
</typescript>
</ex-rag-with-agent>

<boundaries>
### What You CAN Configure

- Chunk size/overlap
- Embedding model
- Number of results (k)
- Metadata filters
- Search algorithms: Similarity, MMR

### What You CANNOT Configure

- Embedding dimensions (per model)
- Mix embeddings from different models in same store
</boundaries>

<fix-chunk-size>
<python>
Chunk size 500-1500 is typically good.
```python
# WRONG: Too small (loses context) or too large (hits limits)
splitter = RecursiveCharacterTextSplitter(chunk_size=50)
splitter = RecursiveCharacterTextSplitter(chunk_size=10000)

# CORRECT
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
```
</python>
<typescript>
Chunk size 500-1500 is typically good.
```typescript
// WRONG: Too small or too large
const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 50 });

// CORRECT
const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
```
</typescript>
</fix-chunk-size>

<fix-chunk-overlap>
<python>
Use overlap (10-20% of chunk size) to maintain context at boundaries.
```python
# WRONG: No overlap - context breaks at boundaries
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=0)

# CORRECT: 10-20% overlap
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
```
</python>
</fix-chunk-overlap>

<fix-persist-vectorstore>
<python>
Use persistent vector store instead of in-memory to avoid data loss.
```python
# WRONG: InMemory - lost on restart
vectorstore = InMemoryVectorStore.from_documents(docs, embeddings)

# CORRECT
vectorstore = Chroma.from_documents(docs, embeddings, persist_directory="./chroma_db")
```
</python>
<typescript>
Use persistent vector store instead of in-memory to avoid data loss.
```typescript
// WRONG: Memory - lost on restart
const vectorstore = await MemoryVectorStore.fromDocuments(docs, embeddings);

// CORRECT
const vectorstore = await Chroma.fromDocuments(docs, embeddings, { collectionName: "my-collection" });
```
</typescript>
</fix-persist-vectorstore>

<fix-consistent-embeddings>
<python>
Use the same embedding model for indexing and querying.
```python
# WRONG: Different embeddings for index and query - incompatible!
vectorstore = Chroma.from_documents(docs, OpenAIEmbeddings(model="text-embedding-3-small"))
retriever = vectorstore.as_retriever(embeddings=OpenAIEmbeddings(model="text-embedding-3-large"))

# CORRECT: Same model
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
vectorstore = Chroma.from_documents(docs, embeddings)
retriever = vectorstore.as_retriever()  # Uses same embeddings
```
</python>
<typescript>
Use the same embedding model for indexing and querying.
```typescript
const embeddings = new OpenAIEmbeddings({ model: "text-embedding-3-small" });
const vectorstore = await Chroma.fromDocuments(docs, embeddings);
const retriever = vectorstore.asRetriever();  // Uses same embeddings
```
</typescript>
</fix-consistent-embeddings>

<fix-faiss-deserialization>
<python>
Explicitly allow deserialization when loading FAISS indexes.
```python
# WRONG: Will raise error
loaded_store = FAISS.load_local("./faiss_index", embeddings)

# CORRECT
loaded_store = FAISS.load_local("./faiss_index", embeddings, allow_dangerous_deserialization=True)
```
</python>
</fix-faiss-deserialization>

<fix-dimension-mismatch>
<python>
Ensure embedding dimensions match the vector store index dimensions.
```python
# WRONG: Index has 1536 dimensions but using 512-dim embeddings
pc.create_index(name="idx", dimension=1536, metric="cosine")
vectorstore = PineconeVectorStore.from_documents(
    docs, OpenAIEmbeddings(model="text-embedding-3-small", dimensions=512), index=pc.Index("idx")
)  # Error: dimension mismatch!

# CORRECT: Match dimensions
embeddings = OpenAIEmbeddings()  # Default 1536
```
</python>
</fix-dimension-mismatch>
