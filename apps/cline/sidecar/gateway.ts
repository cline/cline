import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	GatewayClient,
	readDiscoveryRecord,
	resolveGatewayPaths,
} from "@cline/gateway/client";

/** Every Cline desktop bridge connects to this one Gateway authority. */
export const DESKTOP_GATEWAY_NAMESPACE = "desktop";
const LEAD_PROFILE =
	process.env.CLINE_GATEWAY_LEAD_PROFILE?.trim() || "cline-dad";
const DESKTOP_GATEWAY_REQUEST_TIMEOUT_MS = 15_000;
const GATEWAY_START_TIMEOUT_MS = 25_000;
const GATEWAY_UPGRADE_TIMEOUT_MS = 90_000;
const REQUIRED_GATEWAY_CAPABILITIES = [
	"sessions.create",
	"sessions.dedicated",
	"sessions.fork",
	"runs.queuedMutations",
	"bots.profilePromptLayers",
	"providers.settings",
	"providers.oauth",
	"account.cline",
	"settings.global",
	"voice.transcription",
	"marketplace.management",
	"mcp.settings",
	"plugins.management",
	"connectors.authorization",
	"connectors.slackLoadingStatus",
	"connectors.slackMentionGate",
] as const;

type GatewayLifecycleCommand = "start" | "upgrade";

export interface GatewayLifecycleInvocation {
	executable: string;
	args: string[];
	cwd: string;
}

export function gatewaySpawnCwd(
	compiledSidecar: boolean,
	execPath = process.execPath,
	moduleDir = import.meta.dir,
): string {
	return compiledSidecar ? dirname(execPath) : resolve(moduleDir, "..");
}

/**
 * Resolve the operator CLI without searching another app or SDK host.
 * Compiled sidecars may invoke only their bundled sibling `clinegate`;
 * source sidecars may invoke only this repository's Gateway entrypoint.
 */
export function gatewayLifecycleInvocation(
	command: GatewayLifecycleCommand,
	execPath = process.execPath,
	moduleDir = import.meta.dir,
): GatewayLifecycleInvocation {
	const compiledSidecar = basename(execPath).startsWith("cline-sidecar");
	const packaged = join(
		dirname(execPath),
		process.platform === "win32" ? "clinegate.exe" : "clinegate",
	);
	const entry = resolve(
		moduleDir,
		"../../../sdk/packages/gateway/bin/clinegate.mjs",
	);
	const lifecycleArgs = [
		command,
		"--namespace",
		DESKTOP_GATEWAY_NAMESPACE,
		"--lead-profile",
		LEAD_PROFILE,
	];
	return {
		executable: compiledSidecar ? packaged : execPath,
		args: compiledSidecar ? lifecycleArgs : [entry, ...lifecycleArgs],
		cwd: gatewaySpawnCwd(compiledSidecar, execPath, moduleDir),
	};
}

export function missingDesktopGatewayCapabilities(
	client: GatewayClient,
): string[] {
	return REQUIRED_GATEWAY_CAPABILITIES.filter(
		(capability) => !client.hello.capabilities.includes(capability),
	);
}

function supportsDesktopGateway(client: GatewayClient): boolean {
	return missingDesktopGatewayCapabilities(client).length === 0;
}

async function connect(): Promise<GatewayClient | undefined> {
	const record = readDiscoveryRecord(
		resolveGatewayPaths({ namespace: DESKTOP_GATEWAY_NAMESPACE }).discoveryFile,
	);
	if (!record) return undefined;
	try {
		return await GatewayClient.connectToDiscovery(record, {
			clientName: "cline-desktop",
			clientVersion: "0.0.1",
			requestTimeoutMs: DESKTOP_GATEWAY_REQUEST_TIMEOUT_MS,
		});
	} catch {
		return undefined;
	}
}

async function waitForGateway(): Promise<GatewayClient> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const client = await connect();
		if (client) return client;
		await Bun.sleep(50);
	}
	throw new Error(
		"Gateway lifecycle command completed but discovery connection failed",
	);
}

async function runGatewayLifecycle(
	command: GatewayLifecycleCommand,
): Promise<void> {
	const invocation = gatewayLifecycleInvocation(command);
	if (
		basename(process.execPath).startsWith("cline-sidecar") &&
		!existsSync(invocation.executable)
	) {
		throw new Error(
			`Bundled Gateway executable not found: ${invocation.executable}`,
		);
	}
	await new Promise<void>((resolveCommand, reject) => {
		const child = spawn(invocation.executable, invocation.args, {
			cwd: invocation.cwd,
			env: {
				...process.env,
				CLINE_GATEWAY_NAMESPACE: DESKTOP_GATEWAY_NAMESPACE,
			},
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});
		const timeoutMs =
			command === "upgrade"
				? GATEWAY_UPGRADE_TIMEOUT_MS
				: GATEWAY_START_TIMEOUT_MS;
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`Gateway ${command} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("exit", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolveCommand();
				return;
			}
			const detail = (stderr || stdout).trim();
			reject(
				new Error(
					`Gateway ${command} failed with exit code ${code ?? "unknown"}${detail ? `: ${detail}` : ""}`,
				),
			);
		});
	});
}

export async function ensureGateway(): Promise<{
	client: GatewayClient;
	updateRequired: boolean;
}> {
	const existing = await connect();
	if (existing) {
		return {
			client: existing,
			updateRequired: !supportsDesktopGateway(existing),
		};
	}
	// `clinegate start` is idempotent. Concurrent desktop bridge processes all
	// request the same namespace; the Gateway's OS lock permits one authority
	// and every other starter connects to that winner.
	await runGatewayLifecycle("start");
	return { client: await waitForGateway(), updateRequired: false };
}

export async function updateGateway(client: GatewayClient): Promise<{
	client: GatewayClient;
}> {
	// Upgrades are operator lifecycle operations. The bridge never sends
	// gateway.stop and never owns or kills the authority process.
	client.close();
	await runGatewayLifecycle("upgrade");
	return { client: await waitForGateway() };
}
