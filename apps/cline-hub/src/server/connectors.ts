import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import process from "node:process";
import { listActiveConnectors } from "@cline/core";
import {
	buildConnectorConnectArgs,
	CONNECTOR_PLATFORMS,
	listConnectorCatalog,
	setConnectorCliLaunchSpec,
	withResolvedClineBuildEnv,
} from "@cline/shared";
import type {
	WebviewConnectorChannel,
	WebviewConnectorChannelsResponse,
} from "../webview-protocol";
import { cliIndexPath, workspaceRoot } from "./deps";
import { asRecord, asString } from "./utils";

type CliConnectCommand = {
	launcher: string;
	childArgs: string[];
};

const ANSI_ESCAPE_PATTERN = new RegExp(
	[
		"[\\u001B\\u009B][[\\]()#;?]*",
		"(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007)",
		"|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
	].join(""),
	"g",
);

function stripAnsi(value: string): string {
	return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function normalizeConnectorError(rawMessage: string, fallback: string): string {
	const message =
		stripAnsi(rawMessage)
			.replace(/\r\n/g, "\n")
			.trim()
			.replace(/^(?:error:\s*)+/i, "")
			.trim() || fallback;

	if (
		/^Telegram getMe failed \(401 Unauthorized\): Unauthorized$/i.test(message)
	) {
		return "Telegram rejected this bot token. Copy the token from @BotFather and try again.";
	}

	return message.slice(0, 2_000);
}

function buildCliConnectCommand(
	args: string[],
	options: {
		execPath?: string;
		cliPath?: string;
		exists?: (path: string) => boolean;
	} = {},
): CliConnectCommand {
	const execPath = options.execPath ?? process.execPath;
	const cliPath = options.cliPath ?? cliIndexPath;
	const exists = options.exists ?? existsSync;
	const runtimeName = basename(execPath).toLowerCase();
	const isBunRuntime = runtimeName.includes("bun");
	const isNodeRuntime = runtimeName === "node" || runtimeName === "node.exe";
	const useBunSourceEntrypoint =
		(isBunRuntime || isNodeRuntime) && exists(cliPath);
	const launcher = isBunRuntime
		? execPath
		: useBunSourceEntrypoint
			? "bun"
			: execPath;
	const childArgs = useBunSourceEntrypoint
		? ["--conditions=development", cliPath, "connect", ...args]
		: ["connect", ...args];
	return { launcher, childArgs };
}

export function configureConnectorCliLaunch(): void {
	const command = buildCliConnectCommand([]);
	setConnectorCliLaunchSpec({
		launcher: command.launcher,
		connectArgsPrefix: command.childArgs,
		cwd: workspaceRoot,
	});
}

export function connectorChannelsPayload(): WebviewConnectorChannelsResponse {
	const supported = new Set(
		listConnectorCatalog().map((connector) => connector.name),
	);
	const available: WebviewConnectorChannel[] = CONNECTOR_PLATFORMS.filter(
		(platform) => supported.has(platform.id),
	).map((platform) => ({
		id: platform.id,
		name: platform.name,
		type: platform.type,
		hint: platform.hint,
		fields: platform.fields.map((field) => ({
			flag: field.flag,
			label: field.label,
			placeholder: field.placeholder,
			required: field.required,
			help: field.help,
			initialValue: field.initialValue,
			options: field.options,
			includeWhen: field.includeWhen,
		})),
		security: platform.security
			? {
					prompt: platform.security.prompt,
					fields: platform.security.fields.map((field) => ({
						key: field.key,
						label: field.label,
						placeholder: field.placeholder,
						help: field.help,
						requiredMessage: field.requiredMessage,
					})),
				}
			: undefined,
	}));
	return { available, active: listActiveConnectors() };
}

async function runCliConnectCommand(args: string[]): Promise<{
	code: number;
	stdout: string;
	stderr: string;
}> {
	const { launcher, childArgs } = buildCliConnectCommand(args);
	const child = spawn(launcher, childArgs, {
		cwd: workspaceRoot,
		env: withResolvedClineBuildEnv(process.env),
		stdio: ["ignore", "pipe", "pipe"],
		// Prevent a console window from flashing on Windows.
		windowsHide: true,
	});
	let stdout = "";
	let stderr = "";
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stdout?.on("data", (chunk) => {
		stdout += String(chunk);
	});
	child.stderr?.on("data", (chunk) => {
		stderr += String(chunk);
	});
	const code = await new Promise<number>((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (exitCode) => resolve(exitCode ?? 0));
	});
	return { code, stdout, stderr };
}

async function waitForConnectorState(
	predicate: () => boolean,
	timeoutMs = 5_000,
): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(
		`connector did not reach expected state within ${timeoutMs}ms`,
	);
}

function buildConnectorStartArgs(args?: Record<string, unknown>): string[] {
	const channel = asString(args?.channel);
	if (!channel) throw new Error("channel is required");
	const platform = CONNECTOR_PLATFORMS.find((entry) => entry.id === channel);
	if (!platform) throw new Error(`unknown connector channel: ${channel}`);
	const supported = new Set(
		listConnectorCatalog().map((connector) => connector.name),
	);
	if (!supported.has(platform.id)) {
		throw new Error(`connector channel is not available: ${channel}`);
	}
	const values = asRecord(args?.values) ?? {};
	const fieldValues: Record<string, string> = {};
	for (const field of platform.fields) {
		const rawValue = values[field.flag];
		if (typeof rawValue === "string") {
			fieldValues[field.flag] = rawValue.trim();
		} else if (field.initialValue) {
			fieldValues[field.flag] = field.initialValue;
		}
	}
	const securityInput = asRecord(args?.security);
	const rawSecurityValues = asRecord(securityInput?.values) ?? {};
	const securityValues: Record<string, string> = {};
	for (const [key, value] of Object.entries(rawSecurityValues)) {
		if (typeof value === "string") {
			securityValues[key] = value.trim();
		}
	}
	return [
		channel,
		...buildConnectorConnectArgs(platform, fieldValues, {
			enabled: securityInput?.enabled === true,
			values: securityValues,
		}),
	];
}

function buildConnectorLaunchArgs(
	cliArgs: string[],
	mode: "start" | "restart",
): string[] {
	return mode === "restart" ? ["--restart", ...cliArgs] : cliArgs;
}

function resolveConnectorLaunchMode(
	channel: string,
	activeCount: number,
): "start" | "restart" {
	if (activeCount > 1) {
		throw new Error(
			`cannot safely restart ${channel}: ${activeCount} instances are active; stop the intended instances explicitly first`,
		);
	}
	return activeCount === 1 ? "restart" : "start";
}

export async function startConnectorChannel(
	args?: Record<string, unknown>,
): Promise<WebviewConnectorChannelsResponse> {
	const cliArgs = buildConnectorStartArgs(args);
	const channel = cliArgs[0] ?? "";
	const activeCount = listActiveConnectors().filter(
		(connector) => connector.type === channel,
	).length;
	const mode = resolveConnectorLaunchMode(channel, activeCount);
	const result = await runCliConnectCommand(
		buildConnectorLaunchArgs(cliArgs, mode),
	);
	if (result.code !== 0) {
		throw new Error(
			normalizeConnectorError(
				result.stderr || result.stdout,
				"connector start failed",
			),
		);
	}
	await waitForConnectorState(() =>
		listActiveConnectors().some((connector) => connector.type === channel),
	);
	return connectorChannelsPayload();
}

export const __test__ = {
	buildCliConnectCommand,
	buildConnectorLaunchArgs,
	buildConnectorStartArgs,
	normalizeConnectorError,
	resolveConnectorLaunchMode,
	waitForConnectorState,
};

export async function stopConnectorChannel(
	args?: Record<string, unknown>,
): Promise<WebviewConnectorChannelsResponse> {
	const channel = asString(args?.channel);
	if (!channel) throw new Error("channel is required");
	const supported = new Set(
		listConnectorCatalog().map((connector) => connector.name),
	);
	if (!supported.has(channel)) {
		throw new Error(`unknown connector channel: ${channel}`);
	}
	// `--stop` must precede the channel: the connect command uses
	// passThroughOptions, so flags after the channel go to the adapter.
	const result = await runCliConnectCommand(["--stop", channel]);
	if (result.code !== 0) {
		throw new Error(
			normalizeConnectorError(
				result.stderr || result.stdout,
				"connector stop failed",
			),
		);
	}
	await waitForConnectorState(
		() =>
			!listActiveConnectors().some((connector) => connector.type === channel),
	);
	return connectorChannelsPayload();
}
