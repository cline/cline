# Valyu Design Philosophy

Core principles that guide Valyu's architecture and when to use it.

---

## Core Principles

### 1. Built for AI

Valyu is designed for AI agents and LLMs, not adapted from a traditional search engine.

- **Semantic understanding** over keyword matching
- **Structured JSON responses** for machine consumption
- **Embedding-powered retrieval** for accuracy
- **Focus on reducing hallucinations** by grounding responses in real sources

### 2. One API, Many Sources

A unified interface consolidates multiple authoritative data sources:

- Real-time web content
- Academic papers and research
- Books and publications
- Financial data and filings
- Proprietary datasets

This eliminates the need to integrate multiple APIs separately.

### 3. Transparent Pricing

Pay-per-use CPM pricing with complete cost control:

- User-controlled spending limits (`max_price`)
- Relevance thresholds to filter low-quality results
- Source-specific cost variations
- No hidden fees or subscriptions

---

## Ideal Use Cases

Valyu excels at:

- **Retrieval-Augmented Generation (RAG)** - Grounding LLM responses in real data
- **AI Research Assistants** - Powering knowledge-intensive workflows
- **Knowledge Chatbots** - Providing accurate, sourced answers
- **Real-time Information** - Current events, market data, news
- **Specialized Domain Search** - Academic, financial, medical, legal

---

## Less Suitable Use Cases

Valyu is not designed for:

- Direct user-facing search (not a consumer search engine)
- Social media monitoring
- E-commerce product search
- Local business discovery
- Creative content generation

---

## Implications for Agents

When deciding whether to use Valyu:

| Scenario | Use Valyu? | Reason |
|----------|------------|--------|
| Need factual, sourced information | Yes | Designed for accuracy with citations |
| Need real-time data (news, stocks) | Yes | Live data sources |
| Need academic/research papers | Yes | Access to arXiv, PubMed, etc. |
| Need to answer user questions | Yes | Answer API synthesizes from sources |
| Building a consumer search UI | No | Not optimized for human browsing |
| Need social media content | No | Not a social media aggregator |
| Need creative writing | No | Retrieval-focused, not generative |
