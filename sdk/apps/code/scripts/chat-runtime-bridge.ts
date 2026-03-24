import { homedir } from "node:os";
import { setHomeDir, setHomeDirIfUnset } from "@clinebot/core";
import {
	type RpcRuntimeBridgeCommandOutputLine,
	runRpcRuntimeCommandBridge,
} from "@clinebot/rpc";

function writeLine(line: RpcRuntimeBridgeCommandOutputLine): void {
	process.stdout.write(`${JSON.stringify(line)}\n`);
}

function setRuntimeHomeDir(config: unknown): void {
	if (typeof config !== "object" || config === null) {
		setHomeDirIfUnset(homedir());
		return;
	}
	const sessions = (config as { sessions?: unknown }).sessions;
	const homeDir =
		typeof sessions === "object" && sessions !== null
			? (sessions as { homeDir?: unknown }).homeDir
			: undefined;
	const normalized = typeof homeDir === "string" ? homeDir.trim() : "";
	if (normalized) {
		setHomeDir(normalized);
		return;
	}
	setHomeDirIfUnset(homedir());
}

function addRuntimeLoggerContext(config: unknown): void {
	if (typeof config !== "object" || config === null) {
		return;
	}
	const record = config as Record<string, unknown>;
	const existing =
		typeof record.logger === "object" && record.logger !== null
			? (record.logger as Record<string, unknown>)
			: {};
	const bindings =
		typeof existing.bindings === "object" && existing.bindings !== null
			? (existing.bindings as Record<string, unknown>)
			: {};
	const clientId =
		process.env.CLINE_RPC_CLIENT_ID?.trim() ||
		`code-chat-runtime-bridge-${process.pid}`;
	const clientType = process.env.CLINE_RPC_CLIENT_TYPE?.trim() || "desktop";
	const clientApp = process.env.CLINE_RPC_CLIENT_APP?.trim() || "code";
	record.logger = {
		...existing,
		name:
			(typeof existing.name === "string" && existing.name.trim()) ||
			`clite.${clientApp}`,
		bindings: {
			...bindings,
			clientId,
			clientType,
			clientApp,
		},
	};
}

async function main() {
	const clientId =
		process.env.CLINE_RPC_CLIENT_ID?.trim() ||
		`code-chat-runtime-bridge-${process.pid}`;
	await runRpcRuntimeCommandBridge({
		clientId,
		writeLine,
		onBeforeStart: (config) => {
			setRuntimeHomeDir(config);
			addRuntimeLoggerContext(config);
		},
		onBeforeSend: (request) => {
			if (typeof request !== "object" || request === null) {
				return;
			}
			const config = (request as { config?: unknown }).config;
			setRuntimeHomeDir(config);
			addRuntimeLoggerContext(config);
		},
		parseSendResult: (resultRaw) => resultRaw,
	});
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	writeLine({ type: "error", message });
	process.exit(1);
});
