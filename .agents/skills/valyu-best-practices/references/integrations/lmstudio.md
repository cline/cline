# LM Studio Plugin Integration

The Valyu plugin enhances local LLMs in LM Studio by enabling real-time web search and webpage content extraction capabilities directly within the application.

## Setup Instructions

### 1. Installation

Install the plugin directly from the LM Studio Hub at https://lmstudio.ai/valyu/valyu

### 2. API Key Setup

- Sign up for a free account at https://platform.valyu.ai
- Receive $10 in initial credit
- Paste your API key into the plugin settings within LM Studio

### 3. Configuration

Open the plugin settings and add your API key to activate the search functionality.

## Available Tools

The plugin provides two primary tools for LLM interactions:

**valyu_deepsearch**: Enables web searches to retrieve current information across multiple sources

**valyu_contents**: Extracts and processes text content from specified URLs

## Usage Examples

Users can pose natural language questions such as:

- "What's the latest news about quantum computing?"
- "Find recent research on transformer models"
- "Get Tesla's current stock price"

## Model Compatibility

**Recommended Model Families:**

- Qwen (excellent tool calling support)
- Gemma (reliable tool execution)
- Granite (strong performance)

**Important Note**: Models under 7B parameters frequently struggle with tool calling and may enter loops by repeatedly invoking search tools.

## Troubleshooting

**Common Issues:**

- Verify API key accuracy
- Use larger models (7B+)
- Select from recommended model families
- Switch to more capable models if tools are called repeatedly

## Support

For assistance, join the community Discord at https://discord.gg/umtmSsppRY
