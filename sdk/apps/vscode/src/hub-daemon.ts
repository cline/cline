import {
	createLocalHubScheduleRuntimeHandlers,
	ensureHubWebSocketServer,
	resolveSharedHubOwnerContext,
} from "@clinebot/core";

type DetachedHubDaemonConfig = {
	workspaceRoot: string;
	cwd: string;
	systemPrompt: string;
	defaultProviderId?: string;
	defaultModelId?: string;
};

function parseConfig(argv: string[]): DetachedHubDaemonConfig {
	const encoded = argv[2]?.trim();
	if (!encoded) {
		throw new Error("Missing detached hub daemon config payload.");
	}
	return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

async function main(): Promise<void> {
	parseConfig(process.argv);
	const ensured = await ensureHubWebSocketServer({
		owner: resolveSharedHubOwnerContext(),
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
	});

	const close = async () => {
		await ensured.server?.close();
		process.exit(0);
	};
	process.once("SIGINT", () => {
		void close();
	});
	process.once("SIGTERM", () => {
		void close();
	});
}

void main().catch((error) => {
	process.stderr.write(
		`[cline-vscode hub-daemon] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
	process.exit(1);
});
