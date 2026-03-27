# Claude Agent SDK Integration

This is a **community-maintained** integration developed by [GhouI](https://github.com/GhouI/valyu-claude-agent-sdk).

The Valyu Claude Agent SDK integration enables AI agents built with Anthropic's Claude Agent SDK to access real-time web data and specialized knowledge bases through powerful search capabilities using the Model Context Protocol (MCP).

## Available Search Tools

- **Web Search**: Real-time information, news, and current events
- **Finance Search**: Stock prices, earnings reports, SEC filings, and financial metrics
- **Paper Search**: Academic research from arXiv and scholarly databases
- **Bio Search**: Biomedical literature, PubMed articles, and clinical trials
- **Patent Search**: Patent databases and prior art research
- **SEC Search**: Regulatory documents (10-K, 10-Q, 8-K filings)
- **Economics Search**: Labor statistics, Federal Reserve data, World Bank indicators
- **Company Research**: Comprehensive intelligence reports with synthesized data

## Installation

```bash
git clone https://github.com/GhouI/valyu-claude-agent-sdk.git
cd valyu-claude-agent-sdk
npm install --legacy-peer-deps
```

Configure credentials in `.env`:

```bash
VALYU_API_KEY=your-valyu-api-key-here
```

## Basic Usage

### Web Search Example

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { valyuWebSearchServer } from "./tools/index.js";

async function webSearchExample() {
  for await (const message of query({
    prompt: "What are the latest developments in AI technology?",
    options: {
      model: "claude-sonnet-4-5",
      allowedTools: ["mcp__valyu-web-search__web_search"],
      mcpServers: {
        "valyu-web-search": valyuWebSearchServer,
      },
    },
  })) {
    if (message.type === "assistant") {
      const textContent = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      console.log(textContent);
    }
  }
}

await webSearchExample();
```

### Finance Search Example

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { valyuFinanceSearchServer } from "./tools/index.js";

async function financeSearchExample() {
  for await (const message of query({
    prompt: "What is the current stock price of NVIDIA and their recent earnings?",
    options: {
      model: "claude-sonnet-4-5",
      allowedTools: ["mcp__valyu-finance-search__finance_search"],
      mcpServers: {
        "valyu-finance-search": valyuFinanceSearchServer,
      },
    },
  })) {
    if (message.type === "assistant") {
      const textContent = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      console.log(textContent);
    }
  }
}
```

### Company Research Example

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { valyuCompanyResearchServer } from "./tools/index.js";

async function companyResearchExample() {
  for await (const message of query({
    prompt: "Give me a comprehensive report on OpenAI including leadership, products, and funding",
    options: {
      model: "claude-sonnet-4-5",
      allowedTools: ["mcp__valyu-company-research__company_research"],
      mcpServers: {
        "valyu-company-research": valyuCompanyResearchServer,
      },
    },
  })) {
    if (message.type === "assistant") {
      const textContent = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      console.log(textContent);
    }
  }
}
```

## Multi-Tool Agent

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  valyuWebSearchServer,
  valyuFinanceSearchServer,
  valyuPaperSearchServer,
} from "./tools/index.js";

async function multiToolAgent() {
  for await (const message of query({
    prompt: "Research the impact of AI on financial markets, including recent news and academic papers",
    options: {
      model: "claude-sonnet-4-5",
      allowedTools: [
        "mcp__valyu-web-search__web_search",
        "mcp__valyu-finance-search__finance_search",
        "mcp__valyu-paper-search__paper_search",
      ],
      mcpServers: {
        "valyu-web-search": valyuWebSearchServer,
        "valyu-finance-search": valyuFinanceSearchServer,
        "valyu-paper-search": valyuPaperSearchServer,
      },
    },
  })) {
    if (message.type === "assistant") {
      const textContent = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      console.log(textContent);
    }
  }
}
```

## Custom Bio Search Parameters

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createBioSearchServer } from "./tools/index.js";

const customBioSearchServer = createBioSearchServer({
  searchType: "proprietary",
  maxNumResults: 10,
  includedSources: ["pubmed", "clinicaltrials.gov"],
  maxPrice: 30.0,
  relevanceThreshold: 0.7,
  category: "biomedical",
});

for await (const message of query({
  prompt: "Find clinical trials for CRISPR gene therapy",
  options: {
    model: "claude-sonnet-4-5",
    allowedTools: ["mcp__valyu-bio-search__bio_search"],
    mcpServers: {
      "valyu-bio-search": customBioSearchServer,
    },
  },
})) {
  // Handle messages
}
```

## MCP Tool Identifiers

```
mcp__valyu-web-search__web_search
mcp__valyu-finance-search__finance_search
mcp__valyu-paper-search__paper_search
mcp__valyu-bio-search__bio_search
mcp__valyu-patent-search__patent_search
mcp__valyu-sec-search__sec_search
mcp__valyu-economics-search__economics_search
mcp__valyu-company-research__company_research
```

## Best Practices

### Choose the Right Search Tool

```typescript
// Use finance search for financial data
const financeResults = await query({
  prompt: "What is Apple's stock price?",
  options: {
    allowedTools: ["mcp__valyu-finance-search__finance_search"],
    mcpServers: { "valyu-finance-search": valyuFinanceSearchServer },
  },
});
```

### Cost Optimization

```typescript
const quickSearch = createBioSearchServer({
  maxNumResults: 3,
  maxPrice: 15.0,
  relevanceThreshold: 0.6,
});

const deepSearch = createBioSearchServer({
  maxNumResults: 20,
  maxPrice: 50.0,
  relevanceThreshold: 0.5,
});
```

## Resources

- [GitHub Repository](https://github.com/GhouI/valyu-claude-agent-sdk) - Source code
- [API Reference](https://docs.valyu.ai/api-reference) - Complete Valyu API documentation
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) - Official Anthropic SDK
- [Get API Key](https://platform.valyu.ai) - Sign up for free $10 credit
