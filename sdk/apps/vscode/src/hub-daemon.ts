import * as os from "node:os";
import {
	type ConfiguredTelemetryHandle,
	createConfiguredTelemetryHandle,
	createLocalHubScheduleRuntimeHandlers,
	ensureHubWebSocketServer,
	resolveSharedHubOwnerContext,
} from "@clinebot/core/hub";
import {
	createClineTelemetryServiceConfig,
	createClineTelemetryServiceMetadata,
	type TelemetryMetadata,
} from "@clinebot/shared";

type DetachedHubDaemonConfig = {
	workspaceRoot: string;
	cwd: string;
	systemPrompt: string;
	defaultProviderId?: string;
	defaultModelId?: string;
	/**
	 * Optional telemetry metadata forwarded by the spawning host. When
	 * provided, the daemon constructs an `ITelemetryService` and threads it
	 * into both the hub WebSocket server and the schedule runtime handlers
	 * so workspace lifecycle telemetry (e.g. `workspace.initialized`,
	 * `workspace.init_error`) gets emitted from sessions executed inside
	 * this detached process. Without this, the daemon would still serve
	 * traffic but workspace lifecycle events would never reach the
	 * telemetry pipeline configured by the host.
	 */
	telemetryMetadata?: Partial<TelemetryMetadata>;
};

function parseConfig(argv: string[]): DetachedHubDaemonConfig {
	const encoded = argv[2]?.trim();
	if (!encoded) {
		throw new Error("Missing detached hub daemon config payload.");
	}
	return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

/**
 * Builds a telemetry handle for the detached hub daemon process from
 * metadata forwarded by the host. Returns `undefined` when the host did
 * not provide metadata (e.g. older host versions, manual launches), which
 * preserves the current default of "no telemetry in the daemon". Defers
 * to `createConfiguredTelemetryHandle` so the daemon and the in-process
 * extension share one canonical lifecycle implementation.
 */
function createDaemonTelemetry(
	metadata: Partial<TelemetryMetadata> | undefined,
): ConfiguredTelemetryHandle | undefined {
	if (!metadata || Object.keys(metadata).length === 0) {
		return undefined;
	}
	const config = createClineTelemetryServiceConfig({
		metadata: createClineTelemetryServiceMetadata({
			extension_version: metadata.extension_version,
			cline_type: metadata.cline_type,
			platform: metadata.platform,
			platform_version: metadata.platform_version,
			os_type: metadata.os_type ?? os.platform(),
			os_version: metadata.os_version ?? os.version(),
			is_remote_workspace: metadata.is_remote_workspace,
		}),
	});
	return createConfiguredTelemetryHandle(config);
}

async function main(): Promise<void> {
	const config = parseConfig(process.argv);
	const telemetryHandle = createDaemonTelemetry(config.telemetryMetadata);

	const ensured = await ensureHubWebSocketServer({
		owner: resolveSharedHubOwnerContext(),
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers({
			telemetry: telemetryHandle?.telemetry,
		}),
		telemetry: telemetryHandle?.telemetry,
	});

	let closing = false;
	const close = async () => {
		if (closing) return;
		closing = true;
		try {
			await ensured.server?.close();
		} finally {
			if (telemetryHandle) {
				await telemetryHandle.flush();
				await telemetryHandle.dispose();
			}
			process.exit(0);
		}
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
