---
name: langchain-dependencies
description: "INVOKE THIS SKILL when setting up a new project or when asked about package versions, installation, or dependency management for LangChain, LangGraph, LangSmith, or Deep Agents. Covers required packages, minimum versions, environment requirements, versioning best practices, and common community tool packages for both Python and TypeScript."
---

<overview>
The LangChain ecosystem is split into focused, independently-versioned packages. Understanding which packages you need — and their version constraints — prevents incompatibilities and keeps upgrades predictable.

**Key principles:**
- **LangChain 1.0 is the current LTS release.** Always start new projects on 1.0+. LangChain 0.3 is legacy maintenance-only — do not use it for new work.
- **langchain-core** is the shared foundation: always install it explicitly alongside any other package.
- **langchain-community** (Python only) does NOT follow semantic versioning; pin it conservatively.
- **LangGraph vs Deep Agents:** choose one orchestration approach based on your use case — they are alternatives, not a required stack (see [Framework Choice](#framework-choice) below).
- Provider integrations (model, vector store, tools) are installed separately so you only pull in what you use.
</overview>

---

## Environment Requirements

<environment-requirements>

| Requirement | Python | TypeScript / Node |
|-------------|--------|-------------------|
| Runtime minimum | **Python 3.10+** | **Node.js 20+** |
| LangChain | **1.0+ (LTS)** | **1.0+ (LTS)** |
| LangSmith SDK | >= 0.3.0 | >= 0.3.0 |

</environment-requirements>

---

## Framework Choice

<framework-choice>
Pick **one** agent orchestration layer. You do not need both.

| Framework | When to use | Core extra package |
|-----------|-------------|--------------------|
| **LangGraph** | Need fine-grained graph control, custom workflows, loops, or branching | `langgraph` / `@langchain/langgraph` |
| **Deep Agents** | Want batteries-included planning, memory, file context, and skills out of the box | `deepagents` (depends on LangGraph; installs it as a transitive dep) |

Both sit on top of `langchain` + `langchain-core` + `langsmith`.
</framework-choice>

---

## Core Packages

<python-packages>

### Python — always required

| Package | Role | Min version |
|---------|------|-------------|
| `langchain` | Agents, chains, retrieval | 1.0 |
| `langchain-core` | Base types & interfaces (peer dep) | 1.0 |
| `langsmith` | Tracing, evaluation, datasets | 0.3.0 |

### Python — orchestration (pick one)

| Package | Use when | Min version |
|---------|----------|-------------|
| `langgraph` | Building custom graphs directly | 1.0 |
| `deepagents` | Using the Deep Agents framework | latest |

### Python — model providers (pick the one(s) you use)

| Package | Provider |
|---------|----------|
| `langchain-openai` | OpenAI (GPT-4o, o3, …) |
| `langchain-anthropic` | Anthropic (Claude) |
| `langchain-google-genai` | Google (Gemini) |
| `langchain-mistralai` | Mistral |
| `langchain-groq` | Groq (fast inference) |
| `langchain-cohere` | Cohere |
| `langchain-fireworks` | Fireworks AI |
| `langchain-together` | Together AI |
| `langchain-huggingface` | Hugging Face Hub |
| `langchain-ollama` | Ollama (local models) |
| `langchain-aws` | AWS Bedrock |
| `langchain-azure-ai` | Azure AI Foundry |

### Python — common tool & retrieval packages

These packages have tighter compatibility requirements — use the latest available version unless you have a specific reason not to.

| Package | Adds | Notes |
|---------|------|-------|
| `langchain-tavily` | Tavily web search (`TavilySearch`) | Dedicated integration package; prefer latest |
| `langchain-text-splitters` | Text chunking utilities | Semver, keep current |
| `langchain-community` | 1000+ integrations (fallback) | **NOT semver — pin to minor series** |
| `faiss-cpu` | FAISS vector store (local) | Via `langchain-community`; use latest |
| `langchain-chroma` | Chroma vector store | Dedicated integration package; prefer latest |
| `langchain-pinecone` | Pinecone vector store | Dedicated integration package; prefer latest |
| `langchain-qdrant` | Qdrant vector store | Dedicated integration package; prefer latest |
| `langchain-weaviate` | Weaviate vector store | Dedicated integration package; prefer latest |
| `langsmith[pytest]` | pytest plugin for LangSmith | Requires langsmith >= 0.3.4 |

> **langchain-community stability note:** This package is NOT on semantic versioning. Minor releases can contain breaking changes. Prefer dedicated integration packages (e.g. `langchain-chroma`, `langchain-tavily`) when they exist — they are independently versioned and more stable.

</python-packages>

<typescript-packages>

### TypeScript — always required

| Package | Role | Min version |
|---------|------|-------------|
| `@langchain/core` | Base types & interfaces (peer dep) | 1.0 |
| `langchain` | Agents, chains, retrieval | 1.0 |
| `langsmith` | Tracing, evaluation, datasets | 0.3.0 |

### TypeScript — orchestration (pick one)

| Package | Use when | Min version |
|---------|----------|-------------|
| `@langchain/langgraph` | Building custom graphs directly | 1.0 |
| `deepagents` | Using the Deep Agents framework | latest |

### TypeScript — model providers (pick the one(s) you use)

| Package | Provider |
|---------|----------|
| `@langchain/openai` | OpenAI (GPT-4o, o3, …) |
| `@langchain/anthropic` | Anthropic (Claude) |
| `@langchain/google-genai` | Google (Gemini) |
| `@langchain/mistralai` | Mistral |
| `@langchain/groq` | Groq (fast inference) |
| `@langchain/cohere` | Cohere |
| `@langchain/aws` | AWS Bedrock |
| `@langchain/azure-openai` | Azure OpenAI |
| `@langchain/ollama` | Ollama (local models) |

### TypeScript — common tool & retrieval packages

| Package | Adds | Notes |
|---------|------|-------|
| `@langchain/tavily` | Tavily web search (`TavilySearch`) | Dedicated integration package; prefer latest |
| `@langchain/community` | Broad set of community integrations | Use sparingly; prefer dedicated packages |
| `@langchain/pinecone` | Pinecone vector store | Dedicated integration package; prefer latest |
| `@langchain/qdrant` | Qdrant vector store | Dedicated integration package; prefer latest |
| `@langchain/weaviate` | Weaviate vector store | Dedicated integration package; prefer latest |

> **`@langchain/core` must be installed explicitly** in yarn workspaces and monorepos — it is a peer dependency and will not always be hoisted automatically.

</typescript-packages>

---

## Minimal Project Templates

<ex-langgraph-python>
<python>
Minimal dependency set for a LangGraph project (provider-agnostic).
```
# requirements.txt
langchain>=1.0,<2.0
langchain-core>=1.0,<2.0
langgraph>=1.0,<2.0
langsmith>=0.3.0

# Add your model provider, e.g.:
# langchain-openai
# langchain-anthropic
# langchain-google-genai
```
</python>
</ex-langgraph-python>

<ex-langgraph-typescript>
<typescript>
Minimal package.json dependencies for a LangGraph project (provider-agnostic).
```json
{
  "dependencies": {
    "@langchain/core": "^1.0.0",
    "langchain": "^1.0.0",
    "@langchain/langgraph": "^1.0.0",
    "langsmith": "^0.3.0"
  }
}
```
</typescript>
</ex-langgraph-typescript>

<ex-deepagents-python>
<python>
Minimal dependency set for a Deep Agents project (provider-agnostic).
```
# requirements.txt
deepagents            # bundles langgraph internally
langchain>=1.0,<2.0
langchain-core>=1.0,<2.0
langsmith>=0.3.0

# Add your model provider, e.g.:
# langchain-anthropic
# langchain-openai
```
</python>
</ex-deepagents-python>

<ex-deepagents-typescript>
<typescript>
Minimal package.json dependencies for a Deep Agents project (provider-agnostic).
```json
{
  "dependencies": {
    "deepagents": "latest",
    "@langchain/core": "^1.0.0",
    "langchain": "^1.0.0",
    "langsmith": "^0.3.0"
  }
}
```
</typescript>
</ex-deepagents-typescript>

<ex-with-tools-python>
<python>
Adding Tavily search and a vector store to a LangGraph project.
```
# requirements.txt
langchain>=1.0,<2.0
langchain-core>=1.0,<2.0
langgraph>=1.0,<2.0
langsmith>=0.3.0

# Web search
langchain-tavily          # use latest; partner package, semver

# Vector store — pick one:
langchain-chroma          # use latest; partner package, semver
# langchain-pinecone      # use latest; partner package, semver
# langchain-qdrant        # use latest; partner package, semver

# Text processing
langchain-text-splitters  # use latest; semver

# Your model provider:
# langchain-openai / langchain-anthropic / etc.
```
</python>
</ex-with-tools-python>

<ex-with-tools-typescript>
<typescript>
Adding Tavily search and a vector store to a LangGraph project.
```json
{
  "dependencies": {
    "@langchain/core": "^1.0.0",
    "langchain": "^1.0.0",
    "@langchain/langgraph": "^1.0.0",
    "langsmith": "^0.3.0",
    "@langchain/tavily": "latest",
    "@langchain/pinecone": "latest"
  }
}
```
</typescript>
</ex-with-tools-typescript>

---

## Versioning Policy & Upgrade Strategy

<versioning-policy>

| Package group | Versioning | Safe upgrade strategy |
|---------------|------------|-----------------------|
| `langchain`, `langchain-core` | Strict semver (1.0 LTS) | Allow minor: `>=1.0,<2.0` |
| `langgraph` / `@langchain/langgraph` | Strict semver (v1 LTS) | Allow minor: `>=1.0,<2.0` |
| `langsmith` | Strict semver | Allow minor: `>=0.3.0` |
| Dedicated integration packages (e.g. `langchain-tavily`, `langchain-chroma`) | Independently versioned | Allow minor updates; use latest |
| `langchain-community` | **NOT semver** | Pin exact minor: `>=0.4.0,<0.5.0` |
| `deepagents` | Follow project releases | Pin to tested version in production |

**Breaking changes only happen in major versions** (1.x → 2.x) for all semver-compliant packages. Deprecated features remain functional across the entire 1.x series with warnings.

**Prefer dedicated integration packages over langchain-community.** When a dedicated package exists (e.g. `langchain-chroma` instead of `langchain-community`'s Chroma integration), use it — dedicated packages are independently versioned and better tested.

**Community tool packages (Tavily, vector stores, etc.) should be kept at latest** unless your project requires a locked environment. These packages frequently release compatibility fixes alongside LangChain/LangGraph updates.

</versioning-policy>

---

## Environment Variables

<environment-variables>
All keys are read from the environment at runtime. Set only the keys for services you actually use.

```bash
# LangSmith (always recommended for observability)
LANGSMITH_API_KEY=<your-key>
LANGSMITH_PROJECT=<project-name>   # optional, defaults to "default"

# Model provider — set the one(s) you use
OPENAI_API_KEY=<your-key>
ANTHROPIC_API_KEY=<your-key>
GOOGLE_API_KEY=<your-key>
MISTRAL_API_KEY=<your-key>
GROQ_API_KEY=<your-key>
COHERE_API_KEY=<your-key>
FIREWORKS_API_KEY=<your-key>
TOGETHER_API_KEY=<your-key>
HUGGINGFACEHUB_API_TOKEN=<your-key>

# Common tool/retrieval services
TAVILY_API_KEY=<your-key>          # for Tavily search
PINECONE_API_KEY=<your-key>        # for Pinecone
```
</environment-variables>

---

## Common Mistakes

<fix-legacy-version>
Never start a new project on LangChain 0.3. It is maintenance-only until December 2026.
```
# WRONG: legacy, no new features, security patches only
langchain>=0.3,<0.4

# CORRECT: LangChain 1.0 LTS
langchain>=1.0,<2.0
```
</fix-legacy-version>

<fix-community-unpinned>
`langchain-community` can break on minor version bumps — it does not follow semver.
```
# WRONG: allows minor-version updates that may be breaking
langchain-community>=0.4

# CORRECT: pin to exact minor series
langchain-community>=0.4.0,<0.5.0
```
Also consider switching to the equivalent dedicated integration package if one exists (e.g. `langchain-chroma` instead of the community Chroma integration).
</fix-community-unpinned>

<fix-community-tool-outdated>
Community tool packages like `langchain-tavily` and vector store integrations release compatibility fixes alongside LangChain updates. Using an old pinned version can cause import errors or broken tool schemas.
```
# RISKY: old pin may be incompatible with LangChain 1.0
langchain-tavily==0.0.1

# BETTER: allow latest within the current major
langchain-tavily>=0.1
```
</fix-community-tool-outdated>

<fix-community-import-deprecated>
Many tools that used to live in `langchain-community` now have dedicated packages with updated import paths. Always prefer the dedicated package import.

```python
# WRONG — deprecated community import path
from langchain_community.tools.tavily_search import TavilySearchResults
from langchain_community.tools import WikipediaQueryRun
from langchain_community.vectorstores import Chroma
from langchain_community.vectorstores import Pinecone

# CORRECT — use dedicated package imports
from langchain_tavily import TavilySearch                  # pip: langchain-tavily (TavilySearchResults is deprecated)
from langchain_community.tools import WikipediaQueryRun  # no dedicated pkg yet
from langchain_chroma import Chroma                       # pip: langchain-chroma
from langchain_pinecone import PineconeVectorStore        # pip: langchain-pinecone
```

To find the current canonical import for any integration, search the integrations directory:
https://python.langchain.com/docs/integrations/tools/

Each entry shows the correct package and import path. If a dedicated package exists, use it — the community path may still work but is considered legacy.
</fix-community-import-deprecated>

<fix-core-not-installed>
<typescript>
`@langchain/core` is a peer dependency — it must be in your package.json, especially in monorepos.
```json
// WRONG: missing @langchain/core (breaks in yarn workspaces / strict hoisting)
{
  "dependencies": {
    "@langchain/langgraph": "^1.0.0"
  }
}

// CORRECT: always list @langchain/core explicitly
{
  "dependencies": {
    "@langchain/core": "^1.0.0",
    "@langchain/langgraph": "^1.0.0"
  }
}
```
</typescript>
</fix-core-not-installed>

<fix-python-version>
<python>
Python 3.9 and below are not supported by LangChain 1.0.
```python
# Verify before installing
import sys
assert sys.version_info >= (3, 10), "Python 3.10+ required for LangChain 1.0"
```
</python>
</fix-python-version>

<fix-node-version>
<typescript>
Node.js below 20 is not officially supported.
```bash
# Verify before installing
node --version   # must be v20.x or higher
```
</typescript>
</fix-node-version>
