# XSON MCP Server

This is a custom MCP (Model Context Protocol) server created with [create-xson-cline-app](https://github.com/cline/cline/tree/main/packages/create-xson-cline-app).

## Getting Started

### Development

Run the development server:

```bash
npm run dev
```

### Build

Build the MCP server:

```bash
npm run build
```

### Testing

You can test your MCP server with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Integrating with Cline

To use this MCP server with Cline, add it to your MCP configuration:

1. Open Cline settings
2. Go to MCP Servers
3. Add a new server with the following configuration:

```json
{
  "xson-mcp-server": {
    "command": "node",
    "args": ["/path/to/your/project/dist/index.js"]
  }
}
```

Or if you've published it to npm:

```json
{
  "xson-mcp-server": {
    "command": "npx",
    "args": ["your-package-name"]
  }
}
```

## Available Tools

### hello

Says hello with a custom message.

**Parameters:**
- `name` (string): Name to greet

**Example:**
```
Hello, World! 👋
```

### calculate

Performs basic arithmetic calculations.

**Parameters:**
- `operation` (string): The operation to perform (add, subtract, multiply, divide)
- `a` (number): First number
- `b` (number): Second number

**Example:**
```
5 add 3 = 8
```

## Adding New Tools

To add a new tool:

1. Add the tool definition to the `TOOLS` array in `src/index.ts`
2. Add a handler in the `CallToolRequestSchema` handler
3. Rebuild and test

## Learn More

- [Cline Documentation](https://docs.cline.bot)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/typescript-sdk)

## License

MIT
