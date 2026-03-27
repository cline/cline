# Vercel AI SDK Integration

AI SDK tools for Valyu search API, built for Vercel AI SDK v5.

## Installation

```bash
npm install @valyu/ai-sdk
```

Get your free API key from [Valyu Platform](https://platform.valyu.ai) - **$10 in free credits** when you sign up!

Add to your `.env` file:

```bash
VALYU_API_KEY=your-api-key-here
```

## Quick Start

```typescript
import { generateText } from "ai";
import { webSearch } from "@valyu/ai-sdk";
import { openai } from "@ai-sdk/openai";

const { text } = await generateText({
  model: openai('gpt-5'),
  prompt: 'Latest data center projects for AI inference workloads?',
  tools: {
    webSearch: webSearch(),
  },
});

console.log(text);
```

## Available Search Tools

- **webSearch** - News, current events, general web content
- **financeSearch** - Stock prices, earnings, insider transactions, dividends, balance sheets
- **paperSearch** - Full-text search of PubMed, arXiv, bioRxiv, medRxiv
- **bioSearch** - Clinical trials, FDA drug labels, ChEMBL, DrugBank, Open Targets
- **patentSearch** - USPTO full-text patent search
- **secSearch** - SEC filings (10-K, 10-Q, 8-K)
- **economicsSearch** - Economic indicators from BLS, FRED, World Bank
- **companyResearch** - Comprehensive company intelligence reports

## Search Tool Examples

### Finance Search

```typescript
import { generateText, stepCountIs } from "ai";
import { financeSearch } from "@valyu/ai-sdk";
import { openai } from "@ai-sdk/openai";

const { text } = await generateText({
  model: openai('gpt-5'),
  prompt: 'What was the stock price of Apple from the beginning of 2020 to 14th feb?',
  tools: {
    financeSearch: financeSearch(),
  },
  stopWhen: stepCountIs(10),
});
```

### Paper Search

```typescript
import { generateText, stepCountIs } from "ai";
import { paperSearch } from "@valyu/ai-sdk";
import { openai } from "@ai-sdk/openai";

const { text } = await generateText({
  model: openai('gpt-5'),
  prompt: 'Psilocybin effects on cellular lifespan and longevity in mice?',
  tools: {
    paperSearch: paperSearch(),
  },
  stopWhen: stepCountIs(10),
});
```

## Datasources Discovery Tools

### datasources

List available data sources with metadata, schemas, and pricing.

```typescript
import { generateText } from "ai";
import { datasources } from "@valyu/ai-sdk";
import { openai } from "@ai-sdk/openai";

const { text } = await generateText({
  model: openai('gpt-5'),
  prompt: 'What data sources are available for financial research?',
  tools: {
    datasources: datasources(),
  },
});
```

### datasourcesCategories

List all available categories with dataset counts.

```typescript
import { generateText } from "ai";
import { datasourcesCategories } from "@valyu/ai-sdk";
import { openai } from "@ai-sdk/openai";

const { text } = await generateText({
  model: openai('gpt-5'),
  prompt: 'What categories of data are available?',
  tools: {
    datasourcesCategories: datasourcesCategories(),
  },
});
```

## Multi-Tool Search

```typescript
import { generateText, stepCountIs } from "ai";
import { paperSearch, bioSearch, financeSearch } from "@valyu/ai-sdk";
import { openai } from "@ai-sdk/openai";

const { text } = await generateText({
  model: openai('gpt-5'),
  prompt: 'Research the commercialization of CRISPR technology',
  tools: {
    papers: paperSearch({ maxNumResults: 3 }),
    medical: bioSearch({ maxNumResults: 3 }),
    finance: financeSearch({ maxNumResults: 3 }),
  },
  stopWhen: stepCountIs(3),
});
```

## Configuration Options

```typescript
webSearch({
  apiKey: "your-api-key",
  searchType: "proprietary",
  maxNumResults: 10,
  relevanceThreshold: 0.8,
  maxPrice: 0.01,
  category: "technology",
  includedSources: ["arxiv", "pubmed"],
  isToolCall: true,
})
```

## Streaming Results

```typescript
import { streamText, stepCountIs } from "ai";
import { paperSearch } from "@valyu/ai-sdk";
import { anthropic } from "@ai-sdk/anthropic";

const result = streamText({
  model: anthropic('claude-3-5-sonnet-20241022'),
  prompt: 'Summarize recent quantum computing research',
  tools: {
    papers: paperSearch(),
  },
  stopWhen: stepCountIs(3),
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

## Best Practices

### System Prompting

```typescript
const result = await generateText({
  model: openai('gpt-5'),
  messages: [
    {
      role: 'system',
      content: `You are an AI research assistant with access to specialized search tools.
      - Use webSearch for current events and general web content
      - Use paperSearch for academic research and scientific papers
      - Use financeSearch for stock prices, earnings, and market data
      - Use bioSearch for medical research, clinical trials, drug data
      - Always cite sources using Markdown links: [Title](URL)`
    },
  ],
  tools: {
    web: webSearch(),
    papers: paperSearch(),
    finance: financeSearch(),
    bio: bioSearch(),
  },
  stopWhen: stepCountIs(3),
});
```

### Cost Control

```typescript
webSearch({
  maxPrice: 0.01,
  maxNumResults: 5,
  relevanceThreshold: 0.8,
})
```

## Resources

- [Valyu Platform](https://platform.valyu.ai) - Get your API keys
- [Valyu Documentation](https://docs.valyu.ai) - Full API documentation
- [GitHub Repository](https://github.com/valyu/valyu-ai-sdk) - View source code
