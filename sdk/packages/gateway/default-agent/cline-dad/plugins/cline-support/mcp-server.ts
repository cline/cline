import plugin from "./index";

interface ToolContribution {
	name: string;
	description?: string;
	inputSchema?: unknown;
	execute(input: unknown, context: unknown): unknown | Promise<unknown>;
}

interface CommandContribution {
	name: string;
	description?: string;
	handler(input: string): unknown | Promise<unknown>;
}

const tools = new Map<string, ToolContribution>();
const commands = new Map<string, CommandContribution>();
const workspaceRoot = process.env.CLINE_WORKSPACE_ROOT ?? process.cwd();

await plugin.setup?.(
	{
		registerTool(tool: ToolContribution) {
			tools.set(tool.name, tool);
		},
		registerCommand(command: CommandContribution) {
			commands.set(command.name, command);
		},
		registerRule() {},
		registerMessageBuilder() {},
		registerProvider() {},
		registerAutomationEventType() {},
	} as never,
	{
		client: { name: "cline-gateway", platform: process.platform },
		session: { sessionId: process.env.CLINE_SESSION_ID },
		workspaceInfo: { rootPath: workspaceRoot, hint: workspaceRoot },
		logger: {
			log(message: string, data?: Record<string, unknown>) {
				process.stderr.write(
					`[${plugin.name}] ${message}${data ? ` ${JSON.stringify(data)}` : ""}\n`,
				);
			},
		},
	} as never,
);

for (const command of commands.values()) {
	const name = command.name.replaceAll("-", "_");
	if (!tools.has(name)) {
		tools.set(name, {
			name,
			description: command.description ?? `Run the ${command.name} command.`,
			inputSchema: {
				type: "object",
				properties: { args: { type: "string" } },
			},
			execute: (input) =>
				command.handler(
					typeof input === "object" && input !== null && "args" in input
						? String((input as { args?: unknown }).args ?? "")
						: "",
				),
		});
	}
}

function reply(id: unknown, result?: unknown, error?: unknown): void {
	process.stdout.write(
		`${JSON.stringify(
			error
				? {
						jsonrpc: "2.0",
						id,
						error: { code: -32000, message: String(error) },
					}
				: { jsonrpc: "2.0", id, result },
		)}\n`,
	);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
	buffer += chunk;
	for (;;) {
		const newline = buffer.indexOf("\n");
		if (newline < 0) break;
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (!line) continue;
		void handle(JSON.parse(line)).catch((error) =>
			reply(undefined, undefined, error),
		);
	}
});

async function handle(request: {
	id?: unknown;
	method?: string;
	params?: { name?: string; arguments?: unknown };
}): Promise<void> {
	if (request.id === undefined) return;
	if (request.method === "initialize") {
		reply(request.id, {
			protocolVersion: "2024-11-05",
			serverInfo: { name: plugin.name, version: "1.0.0" },
			capabilities: { tools: {} },
		});
		return;
	}
	if (request.method === "tools/list") {
		reply(request.id, {
			tools: [...tools.values()].map((tool) => ({
				name: tool.name,
				description: tool.description ?? tool.name,
				inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
			})),
		});
		return;
	}
	if (request.method === "tools/call") {
		const tool = tools.get(request.params?.name ?? "");
		if (!tool) throw new Error(`Unknown tool: ${request.params?.name ?? ""}`);
		const output = await tool.execute(request.params?.arguments ?? {}, {
			agentId: plugin.name,
			conversationId: process.env.CLINE_SESSION_ID ?? "gateway",
			iteration: 0,
		});
		reply(request.id, {
			content: [
				{
					type: "text",
					text: typeof output === "string" ? output : JSON.stringify(output),
				},
			],
			...(typeof output === "object" &&
			output !== null &&
			!Array.isArray(output)
				? { structuredContent: output }
				: {}),
		});
		return;
	}
	reply(request.id, undefined, `Unsupported method: ${request.method ?? ""}`);
}
