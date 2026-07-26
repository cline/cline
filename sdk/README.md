# Cline SDK

The Cline SDK is the Bedrock-backed TypeScript runtime used by the retained
VS Code extension. It provides an agent loop, tools, persistent sessions,
plugins, automations, and local or hub-backed execution.

## Runtime

The inference path is intentionally AWS Bedrock only. Standalone agents accept
a Bedrock model ID and connection settings:

```ts
import { Agent } from "@cline/agents";

const agent = new Agent({
	providerId: "bedrock",
	modelId: "anthropic.claude-sonnet-4-20250514-v1:0",
	connection: {
		region: "us-east-1",
		profile: "default",
	},
	systemPrompt: "You are a helpful coding assistant.",
	tools: [],
});

const result = await agent.run("Summarize this project.");
console.log(result.text);
```

Credentials are resolved by the AWS SDK credential chain. They are not stored
in the generic agent or RPC contracts.

## Packages

| Package | Responsibility |
| --- | --- |
| `@cline/shared` | Shared runtime, tool, hook, and transport contracts |
| `@cline/llms` | Bedrock model construction and streaming |
| `@cline/agents` | Stateless agent loop and tool execution |
| `@cline/core` | Stateful sessions, storage, plugins, automation, and hub services |

SDK packages resolve workspace dependencies through compiled `dist/` exports.
After changing SDK source, build the complete SDK before running extension or
SDK tests:

```sh
bun run build:sdk
```

The retained host implementation is the VS Code extension in
[`apps/vscode`](../apps/vscode).

## License

[Apache 2.0 © 2026 Cline Bot Inc.](./LICENSE)
