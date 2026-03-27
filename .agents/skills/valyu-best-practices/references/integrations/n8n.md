# n8n Integration

Valyu offers a community node for n8n that brings AI-powered search, extraction, and research capabilities into workflow automation. The integration is available exclusively on self-hosted n8n instances.

## Core Capabilities

The Valyu node provides four main operations:

**Search**: Search across the web and premium data sources (academic papers, financial data, news) with customizable filters for search type, results count, response length, and date ranges.

**Extraction**: Pull clean content from webpages with optional AI summarization. Supports raw text extraction, auto-summaries, custom prompts, or structured JSON output.

**Answer**: Generate instant AI-powered answers to questions, backed by real search results for quick Q&A and chatbot applications.

**Deep Research**: Comprehensive multi-source research producing detailed reports in 10-30 minutes depending on complexity mode selected.

## Installation & Setup

### Prerequisites

- Self-hosted n8n instance (not available on n8n Cloud)
- Free Valyu account at platform.valyu.ai
- API key from Valyu dashboard

### Installation Steps

1. Navigate to Settings > Community Nodes > Install
2. Enter package name: `n8n-nodes-valyu`
3. Accept community node risks and confirm installation

### Credential Configuration

1. Add Valyu node to canvas
2. Create new credential with:
   - **API Key**: Your Valyu platform key
   - **API URL**: `https://api.valyu.network` (default)
3. Save credentials for reuse across workflows

## Example Workflows

**News Digest**: Schedule trigger > Search operation > Answer operation > Email node

**Content Monitoring**: Weekly schedule > Extraction operation > Comparison logic > Slack notification

**Research Pipeline**: Webhook trigger > Deep Research operation > Google Sheets > Slack alert

## Troubleshooting

- Restart n8n instance if node doesn't appear post-installation
- Verify API key has no extra spaces
- Allow extended timeouts (up to 30 minutes) for Heavy mode research
- Implement delays between operations if rate limiting occurs

## Resources

- npm package: n8n-nodes-valyu
- GitHub: github.com/valyuAI/n8n-nodes-valyu
- Community support: discord.gg/umtmSsppRY
