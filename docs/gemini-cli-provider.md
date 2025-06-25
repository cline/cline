# Gemini CLI Provider for Cline

This document describes how to use the Gemini CLI as a provider in Cline.

## Overview

The Gemini CLI provider allows you to use Google's Gemini models through the Gemini CLI tool instead of using API keys directly. This can be useful if you:

- Already have the Gemini CLI installed and configured
- Want to use the CLI's authentication methods (OAuth, etc.)
- Prefer to manage your Gemini access through the CLI

## Prerequisites

1. **Install the Gemini CLI**: The Gemini CLI must be installed and accessible from your system PATH.
   
2. **Set up authentication**: The CLI needs to be authenticated. You can either:
   - Set the `GEMINI_API_KEY` environment variable
   - Use the CLI's built-in authentication methods

3. **Build the CLI** (if using from source):
   ```bash
   cd gemini-cli/packages/cli
   npm install
   npm run build
   ```

## Configuration

To use the Gemini CLI provider in Cline:

1. Open Cline settings
2. Select "Gemini CLI" as your API provider
3. (Optional) Specify the path to the Gemini CLI executable if it's not in your PATH
4. Select your desired Gemini model

## Supported Models

The Gemini CLI provider supports the same models as the regular Gemini provider:

- gemini-2.5-pro
- gemini-2.5-flash
- gemini-2.0-flash-001
- gemini-1.5-flash-002
- gemini-1.5-pro-002

## How It Works

1. When you send a message in Cline, it converts your conversation to a format the Gemini CLI understands
2. Cline spawns the Gemini CLI as a subprocess with your prompt
3. The CLI's response is streamed back to Cline
4. The response is displayed in the Cline interface

## Limitations

- **No image support**: The Gemini CLI in non-interactive mode doesn't support images
- **No tool execution**: The CLI handles its own tool execution, which doesn't integrate with Cline's tools
- **Token counting**: Token usage is estimated based on text length rather than actual token counts
- **No caching**: The CLI doesn't support Anthropic-style prompt caching

## Troubleshooting

### CLI not found
- Ensure the Gemini CLI is installed and in your PATH
- Or specify the full path to the CLI in Cline settings

### Authentication errors
- Check that `GEMINI_API_KEY` is set in your environment
- Or ensure the CLI is authenticated using its built-in methods

### No response
- Try running the CLI manually to ensure it works:
  ```bash
  gemini --prompt "Hello, world!"
  ```

### Build errors
If using from source, ensure the CLI is built:
```bash
cd gemini-cli/packages/cli
npm install
npm run build
```

## Testing

You can test the integration using the provided test script:

```bash
node test-gemini-cli.js
```

This will attempt to run a simple prompt through the CLI and report whether it succeeded.
