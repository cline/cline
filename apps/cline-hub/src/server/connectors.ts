import { spawn } from "node:child_process";
import process from "node:process";
import { listConnectorCatalog } from "../../../cli/src/connectors/catalog";
import { listActiveConnectors } from "../../../cli/src/connectors/status";
import { PLATFORMS } from "../../../cli/src/wizards/connect/platforms";
import type {
	WebviewConnectorChannel,
	WebviewConnectorChannelsResponse,
} from "../webview-protocol";
import { cliIndexPath, workspaceRoot } from "./deps";
import { asRecord, asString } from "./utils";

export function connectorChannelsPayload(): WebviewConnectorChannelsResponse {
	const supported = new Set(
		listConnectorCatalog().map((connector) => connector.name),
	);
	const available: WebviewConnectorChannel[] = PLATFORMS.filter((platform) =>
		supported.has(platform.id),
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
	const launcher = (process.versions as Record<string, string | undefined>).bun
		? process.execPath
		: "bun";
	const child = spawn(
		launcher,
		["--conditions=development", cliIndexPath, "connect", ...args],
		{
			cwd: workspaceRoot,
			env: {
				...process.env,
				CLINE_BUILD_ENV: process.env.CLINE_BUILD_ENV ?? "development",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
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
}

function buildConnectorStartArgs(args?: Record<string, unknown>): string[] {
	const channel = asString(args?.channel);
	if (!channel) throw new Error("channel is required");
	const platform = PLATFORMS.find((entry) => entry.id === channel);
	if (!platform) throw new Error(`unknown connector channel: ${channel}`);
	const supported = new Set(
		listConnectorCatalog().map((connector) => connector.name),
	);
	if (!supported.has(platform.id)) {
		throw new Error(`connector channel is not available: ${channel}`);
	}
	const values = asRecord(args?.values) ?? {};
	const cliArgs = [channel];
	for (const field of platform.fields) {
		const value = asString(values[field.flag]);
		if (!value) {
			if (field.required) throw new Error(`${field.label} is required`);
			continue;
		}
		cliArgs.push(field.flag, value);
	}
	const security = asRecord(args?.security);
	if (security?.enabled === true && platform.security) {
		const securityValues = asRecord(security.values) ?? {};
		const hookValues: Record<string, string> = {};
		for (const field of platform.security.fields) {
			const value = asString(securityValues[field.key]);
			if (!value) throw new Error(field.requiredMessage);
			const validationError = field.validate?.(value);
			if (validationError) throw new Error(validationError);
			hookValues[field.key] = value;
		}
		cliArgs.push(
			"--hook-command",
			platform.security.buildHookCommand(hookValues),
		);
	}
	return cliArgs;
}

export async function startConnectorChannel(
	args?: Record<string, unknown>,
): Promise<WebviewConnectorChannelsResponse> {
	const cliArgs = buildConnectorStartArgs(args);
	const channel = cliArgs[0] ?? "";
	const result = await runCliConnectCommand(cliArgs);
	if (result.code !== 0) {
		throw new Error(
			(result.stderr.trim() || result.stdout.trim() || "connector start failed")
				.trim()
				.slice(0, 2_000),
		);
	}
	await waitForConnectorState(() =>
		listActiveConnectors().some((connector) => connector.type === channel),
	);
	return connectorChannelsPayload();
}

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
	const result = await runCliConnectCommand([channel, "--stop"]);
	if (result.code !== 0) {
		throw new Error(
			(result.stderr.trim() || result.stdout.trim() || "connector stop failed")
				.trim()
				.slice(0, 2_000),
		);
	}
	await waitForConnectorState(
		() =>
			!listActiveConnectors().some((connector) => connector.type === channel),
	);
	return connectorChannelsPayload();
}
