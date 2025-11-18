# create-xson-cline-app

Create XSON Cline applications with a single command.

## Quick Start

```bash
npx create-xson-cline-app my-app
cd my-app
npm run dev
```

## Usage

### Interactive Mode

```bash
npx create-xson-cline-app
```

The CLI will prompt you for:
- Project name
- Template selection
- Package manager (npm, yarn, or pnpm)
- Git initialization
- Dependency installation

### Command Line Mode

```bash
npx create-xson-cline-app <project-name> [options]
```

#### Options

- `-t, --template <template>` - Template to use (default, mcp-server, cli-tool, vscode-extension)
- `-p, --package-manager <pm>` - Package manager to use (npm, yarn, pnpm)
- `--no-git` - Skip git initialization
- `--no-install` - Skip dependency installation

#### Examples

```bash
# Create a default app
npx create-xson-cline-app my-app

# Create an MCP server
npx create-xson-cline-app my-mcp-server --template mcp-server

# Create a CLI tool with yarn
npx create-xson-cline-app my-cli --template cli-tool --package-manager yarn

# Create without installing dependencies
npx create-xson-cline-app my-app --no-install
```

## Templates

### Default

A basic Cline-integrated application. Perfect for getting started or building custom applications.

**Use cases:**
- Learning Cline integration
- Building custom applications
- Rapid prototyping

```bash
npx create-xson-cline-app my-app --template default
```

### MCP Server

A template for building custom Model Context Protocol (MCP) servers that extend Cline's capabilities.

**Use cases:**
- Adding custom tools to Cline
- Integrating external APIs
- Building domain-specific assistants

**Features:**
- Pre-configured MCP SDK
- Example tools (hello, calculate)
- TypeScript support
- Ready for Cline integration

```bash
npx create-xson-cline-app my-mcp-server --template mcp-server
```

### CLI Tool

A command-line tool template with common CLI patterns.

**Use cases:**
- Building CLI applications
- Task automation
- Developer tools

**Features:**
- Commander.js for CLI parsing
- Chalk for colored output
- Ora for spinners
- Inquirer for prompts

```bash
npx create-xson-cline-app my-cli --template cli-tool
```

### VS Code Extension

A template for building VS Code extensions integrated with Cline.

**Use cases:**
- Extending VS Code with AI features
- Custom editor commands
- Workspace automation

**Features:**
- VS Code extension scaffolding
- TypeScript support
- Example commands
- Ready to debug (F5)

```bash
npx create-xson-cline-app my-extension --template vscode-extension
```

## What's Included?

All templates include:

- **TypeScript** - Type-safe development
- **Development mode** - Hot reload with `tsx watch`
- **Build scripts** - Production-ready builds
- **Git-friendly** - Pre-configured `.gitignore`
- **Cline integration** - `.clinerules` for AI assistance
- **Best practices** - Recommended project structure

## Project Structure

After creating a project, you'll have:

```
my-app/
├── src/
│   └── index.ts        # Main entry point
├── dist/               # Build output (generated)
├── node_modules/       # Dependencies
├── .gitignore
├── .clinerules         # Cline configuration
├── package.json
├── tsconfig.json
└── README.md
```

## Development Workflow

1. **Create your project**
   ```bash
   npx create-xson-cline-app my-app
   cd my-app
   ```

2. **Start development**
   ```bash
   npm run dev
   ```

3. **Build for production**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

## MCP Server Integration

After creating an MCP server with this tool:

1. Build your server: `npm run build`
2. Open Cline settings in VS Code
3. Navigate to MCP Servers
4. Add your server configuration:

```json
{
  "your-server-name": {
    "command": "node",
    "args": ["/absolute/path/to/your/server/dist/index.js"]
  }
}
```

Or if published to npm:

```json
{
  "your-server-name": {
    "command": "npx",
    "args": ["your-package-name"]
  }
}
```

## Requirements

- Node.js >= 18.0.0
- npm, yarn, or pnpm

## Publishing to npm

To publish your package to npm:

1. **Update package.json**
   - Change the name to your desired package name
   - Update description, author, and other metadata

2. **Build your project**
   ```bash
   npm run build
   ```

3. **Login to npm**
   ```bash
   npm login
   ```

4. **Publish**
   ```bash
   npm publish
   ```

For MCP servers, consider publishing under the `@xjson` or your own npm scope.

## Learn More

- [Cline Documentation](https://docs.cline.bot)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Cline GitHub Repository](https://github.com/cline/cline)

## Contributing

Contributions are welcome! Please read our [Contributing Guide](../../CONTRIBUTING.md) for details.

## License

Apache-2.0 © Cline Bot Inc.

## Support

- [GitHub Issues](https://github.com/cline/cline/issues)
- [Discord Community](https://discord.gg/cline)
- [Documentation](https://docs.cline.bot)

---

**Made with ❤️ by the Cline team**
