# Quick Start Guide

Get started with Cline SDK examples in 5 minutes.

## Prerequisites

1. **Install Bun** (if you haven't already):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Set API Key** for your preferred AI provider:
   ```bash
   # Anthropic (Claude)
   export ANTHROPIC_API_KEY=sk-ant-...
   
   # OpenAI (GPT)
   export OPENAI_API_KEY=sk-...
   
   # Google (Gemini)
   export GEMINI_API_KEY=...
   ```

3. **Navigate to examples directory**:
   ```bash
   cd apps/examples/cline-sdk
   ```

## Run Your First Example

```bash
# Run the minimal example
bun run 01-minimal.ts
```

You should see the agent respond to your prompt!

## Try More Examples

```bash
# Custom model selection
bun run 02-custom-model.ts

# System prompt customization
bun run 03-system-prompt.ts

# Built-in tools
bun run 04-tools.ts
```

## Using NPM Scripts

The package.json includes convenient scripts:

```bash
# Run specific example
bun run 01  # runs 01-minimal.ts
bun run 05  # runs 05-custom-tools.ts

# Run all beginner examples
bun run all:beginner

# Run all intermediate examples
bun run all:intermediate

# Run all advanced examples
bun run all:advanced
```

## Learning Path

### Day 1: Basics (30 minutes)
1. `01-minimal.ts` - Understand basic session creation
2. `02-custom-model.ts` - Learn model configuration
3. `03-system-prompt.ts` - Customize agent behavior
4. `04-tools.ts` - Enable/disable tools

### Day 2: Customization (1 hour)
5. `05-custom-tools.ts` - Create your own tools
6. `06-hooks.ts` - Hook into lifecycle events
7. `07-extensions.ts` - Add capabilities with extensions
8. `08-context-files.ts` - Work with file context

### Day 3: Sessions (30 minutes)
9. `09-sessions.ts` - Manage multiple sessions

### Week 2: Advanced (2-3 hours)
10. `10-spawn-agents.ts` - Parallel sub-agents
11. `11-teams.ts` - Multi-agent coordination
12. `12-custom-executors.ts` - Custom tool executors
13. `13-full-control.ts` - Production-ready setup
14. `14-agentic-loop.ts` - Build your own orchestration loop

## Common Issues

### "ANTHROPIC_API_KEY is not set"
```bash
export ANTHROPIC_API_KEY=your-key-here
```

### "Cannot find module @clinebot/core"
```bash
# Make sure you're in the workspace root
cd ../../..
bun install
bun run build:sdk
```

### TypeScript errors
```bash
# Rebuild the workspace
cd ../../..
bun run build
```

## Next Steps

1. **Read the full README**: [README.md](./README.md)
2. **Modify examples**: Copy an example and customize it
3. **Build your agent**: Use the patterns from examples
4. **Check documentation**: See package READMEs in `packages/`

## Getting Help

- **SDK Documentation**: [`packages/README.md`](../../../packages/README.md)
- **Architecture Guide**: [`ARCHITECTURE.md`](../../../ARCHITECTURE.md)
- **CLI Reference**: [`apps/cli/DOC.md`](../../cli/DOC.md)

## Example Use Cases

After learning the basics, try building:

- **Code Analyzer**: Uses tools to read and analyze code
- **Documentation Generator**: Reads code, writes docs
- **Refactoring Assistant**: Suggests and applies code improvements
- **Test Generator**: Creates test cases from code
- **PR Reviewer**: Analyzes pull requests
- **CLI Tool**: Wraps agent in a command-line interface
- **Web Service**: Expose agent via REST API
- **Slack Bot**: Integrate with team chat
- **CI/CD Integration**: Automate code reviews in pipelines

See the `examples/` and `apps/` directories for real life and more complex examples beyond the basic SDK examples.

Happy coding!
