# Alibaba Cloud AI Provider Implementation

## Overview
This provider implements integration with Alibaba Cloud's Model Studio AI service, specifically the Qwen language models.

## Configuration
- `alibabaCloudApiKey`: Your Alibaba Cloud API key (starts with 'sk-')
- `alibabaCloudBaseUrl`: Optional custom base URL (defaults to Dashscope international endpoint)
- `alibabaCloudModelId`: Model selection (qwen-plus, qwen-turbo, qwen-max)

## Supported Models
1. `qwen-plus`: 8192 max tokens, 32k context window
2. `qwen-turbo`: 6144 max tokens, 16k context window
3. `qwen-max`: 16384 max tokens, 64k context window
4. `qwen2-72b-instruct`: 128000 max tokens, 131072 context window
5. `qwen2-57b-a14b-instruct`: 128000 max tokens, 131072 context window
6. `qwen2-7b-instruct`: 128000 max tokens, 131072 context window

## Authentication
- Use API keys from Alibaba Cloud Model Studio
- Ensure key is prefixed with 'sk-'
- Keep API key confidential

## Streaming Support
- Full streaming support via OpenAI-compatible API
- Real-time token generation
- Error handling for network and API issues

## Best Practices
- Always validate API key before use
- Handle potential network interruptions
- Implement appropriate error logging

## Limitations
- No image support
- No computer use capabilities
- No prompt caching

## Getting Started
1. Obtain API key from Alibaba Cloud
2. Configure in application settings
3. Select appropriate model
4. Start generating content!

## Troubleshooting
- Check API key validity
- Verify network connectivity
- Review error logs
- Contact Alibaba Cloud support if persistent issues occur
