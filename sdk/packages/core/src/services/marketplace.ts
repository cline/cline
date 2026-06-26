import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { resolveClineDir, resolveMcpSettingsPath } from "@cline/shared/storage";
import { updateMcpSettingsFileSync } from "../extensions/mcp";
import { parseMcpInstallArgs } from "./mcp-install";
import { uninstallPlugin } from "./plugin-uninstall";

export type MarketplacePrimitiveType = "mcp" | "skill" | "plugin";

export type MarketplaceEntryInput = {
	id: string;
	type: MarketplacePrimitiveType;
	name?: string;
	install?: {
		args?: string[];
	};
};

export type MarketplaceActionResult = {
	id: string;
	type: MarketplacePrimitiveType;
	status: "installed" | "uninstalled";
	message: string;
	output?: string;
};

export type MarketplaceSpawnResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type MarketplaceSpawnCommand = (
	command: string,
	args: string[],
) => Promise<MarketplaceSpawnResult>;

export type UninstallMarketplaceEntryOptions = {
	deleteMcpServer?: (name: string) => void | Promise<void>;
	mcpSettingsPath?: string;
	spawnCommand?: MarketplaceSpawnCommand;
	workspaceRoot?: string;
};

const MARKETPLACE_COMMAND_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 12_000;
const SECRET_PATTERN =
	/(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth(?:orization)?[_ -]?token|token|secret|password|authorization|credential)/i;
const SECRET_KEY_VALUE_PATTERN =
	/((?:^|[^\w])(?:[a-z0-9_]*?(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth(?:orization)?[_ -]?token|token|secret|password|credential)[a-z0-9_]*)\s*[:=]\s*)(.+)$/gi;
const SECRET_BEARER_VALUE_PATTERN =
	/((?:^|[^\w])authorization\s*[:=]\s*)bearer\s+([^\s,"'}\]]+)/gi;
const SECRET_AUTHORIZATION_VALUE_PATTERN =
	/((?:^|[^\w])authorization\s*[:=])(?!\s*bearer\b)\s*(.+)$/gi;

function getMarketplaceEntryArgs(entry: MarketplaceEntryInput): string[] {
	return entry.install?.args ?? [];
}

function resolveHomeDir(): string {
	return (
		process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir()
	);
}

function sanitizeSkillSegment(value: string): string {
	const sanitized = value
		.toLowerCase()
		.replace(/[^a-z0-9._]+/g, "-")
		.replace(/^[.-]+|[.-]+$/g, "")
		.slice(0, 255);
	return sanitized || "skill";
}

function redactOutput(value: string): string {
	return value
		.split(/\r?\n/)
		.map((line) => {
			if (!SECRET_PATTERN.test(line)) return line;
			return line
				.replace(SECRET_KEY_VALUE_PATTERN, "$1[redacted]")
				.replace(SECRET_BEARER_VALUE_PATTERN, "$1Bearer [redacted]")
				.replace(
					/\b(Bearer)\s+(?!\[redacted\])([^\s,"'}\]]+)/gi,
					"$1 [redacted]",
				)
				.replace(SECRET_AUTHORIZATION_VALUE_PATTERN, "$1 [redacted]")
				.replace(
					/((?:^|[^\w])(?:api\s+key|access\s+token|refresh\s+token|auth(?:orization)?\s+token|secret|password|credential)\s+(?:is\s+)?)(\S+)/gi,
					"$1[redacted]",
				);
		})
		.join("\n")
		.slice(-MAX_OUTPUT_CHARS);
}

function commandOutput(result: MarketplaceSpawnResult): string | undefined {
	const output = redactOutput(
		[result.stdout, result.stderr].filter(Boolean).join("\n"),
	).trim();
	return output.length > 0 ? output : undefined;
}

function quoteCommandPart(value: string): string {
	if (value === "") return '""';
	if (/^[a-zA-Z0-9_./:=@%+,-]+$/.test(value)) return value;
	return JSON.stringify(value);
}

function formatCommand(command: string, args: string[]): string {
	return [command, ...args]
		.map((part) => quoteCommandPart(redactOutput(part).trim()))
		.join(" ");
}

const defaultMarketplaceSpawnCommand: MarketplaceSpawnCommand = async (
	command,
	args,
) =>
	new Promise<MarketplaceSpawnResult>((resolve, reject) => {
		let settled = false;
		let timedOut = false;
		const child = spawn(command, args, {
			env: process.env,
			shell: platform() === "win32",
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		const forceKillTimeout = setTimeout(() => {
			if (!settled) child.kill("SIGKILL");
		}, MARKETPLACE_COMMAND_TIMEOUT_MS + 5_000);
		const timeout = setTimeout(() => {
			timedOut = true;
			stderr += `\nTimed out after ${MARKETPLACE_COMMAND_TIMEOUT_MS / 1000}s.`;
			child.kill("SIGTERM");
		}, MARKETPLACE_COMMAND_TIMEOUT_MS);
		forceKillTimeout.unref?.();
		timeout.unref?.();
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk);
			if (stdout.length > MAX_OUTPUT_CHARS * 2) {
				stdout = stdout.slice(-MAX_OUTPUT_CHARS);
			}
		});
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
			if (stderr.length > MAX_OUTPUT_CHARS * 2) {
				stderr = stderr.slice(-MAX_OUTPUT_CHARS);
			}
		});
		child.once("error", (error) => {
			clearTimeout(timeout);
			clearTimeout(forceKillTimeout);
			reject(error);
		});
		child.once("close", (code, signal) => {
			settled = true;
			clearTimeout(timeout);
			clearTimeout(forceKillTimeout);
			resolve({
				exitCode: timedOut ? 124 : (code ?? (signal === "SIGINT" ? 130 : 1)),
				stdout,
				stderr,
			});
		});
	});

export function marketplaceEntryKey(
	entry: Pick<MarketplaceEntryInput, "id" | "type">,
): string {
	return `${entry.type}:${entry.id}`;
}

export function resolveMarketplaceMcpServerName(
	entry: MarketplaceEntryInput,
): string {
	const args = getMarketplaceEntryArgs(entry);
	if (args.length === 0) {
		throw new Error("Marketplace install args are required.");
	}
	return parseMcpInstallArgs(args).name;
}

export function uninstallMarketplaceMcpServerFromSettings(
	entry: MarketplaceEntryInput,
	options: Pick<UninstallMarketplaceEntryOptions, "mcpSettingsPath"> = {},
): { name: string; deleted: boolean } {
	const name = resolveMarketplaceMcpServerName(entry);
	const settingsPath = options.mcpSettingsPath ?? resolveMcpSettingsPath();
	const deleted = updateMcpSettingsFileSync(settingsPath, (settings) => {
		const servers =
			settings.mcpServers &&
			typeof settings.mcpServers === "object" &&
			!Array.isArray(settings.mcpServers)
				? (settings.mcpServers as Record<string, unknown>)
				: {};
		const hadServer = Object.hasOwn(servers, name);
		if (hadServer) {
			delete servers[name];
		}
		settings.mcpServers = servers;
		return hadServer;
	});
	return { name, deleted };
}

export function getMarketplaceSkillCandidates(
	entry: MarketplaceEntryInput,
): string[] {
	const candidates = new Set<string>();
	const addCandidate = (value: string | undefined) => {
		const normalized = sanitizeSkillSegment(value ?? "");
		if (normalized && normalized !== "skill") {
			candidates.add(normalized);
		}
	};
	addCandidate(entry.id);
	addCandidate(entry.name);
	const installArgs = getMarketplaceEntryArgs(entry);
	for (let index = 0; index < installArgs.length; index++) {
		const arg = installArgs[index];
		if ((arg === "--skill" || arg === "-s") && installArgs[index + 1]) {
			addCandidate(installArgs[index + 1]);
			index++;
			continue;
		}
		const skillFilter = arg.split("@").at(1);
		if (skillFilter) {
			addCandidate(skillFilter);
		}
	}
	return [...candidates];
}

export function getGlobalMarketplaceSkillPaths(skillName: string): string[] {
	return [
		join(resolveClineDir(), "skills", skillName, "SKILL.md"),
		join(resolveHomeDir(), ".agents", "skills", skillName, "SKILL.md"),
	].filter((path, index, paths) => paths.indexOf(path) === index);
}

export function findInstalledGlobalMarketplaceSkillName(
	entry: MarketplaceEntryInput,
): string | undefined {
	if (entry.type !== "skill") return undefined;
	return getMarketplaceSkillCandidates(entry).find((candidate) =>
		getGlobalMarketplaceSkillPaths(candidate).some((path) => existsSync(path)),
	);
}

export function isMarketplaceSkillInstalled(
	entry: MarketplaceEntryInput,
): boolean {
	return findInstalledGlobalMarketplaceSkillName(entry) !== undefined;
}

export async function uninstallMarketplaceSkill(
	entry: MarketplaceEntryInput,
	options: Pick<UninstallMarketplaceEntryOptions, "spawnCommand"> = {},
): Promise<MarketplaceActionResult> {
	const installedName = findInstalledGlobalMarketplaceSkillName(entry);
	if (!installedName) {
		return {
			id: entry.id,
			type: "skill",
			status: "uninstalled",
			message: `${entry.name ?? entry.id} is not installed.`,
		};
	}
	const command = "npx";
	const commandArgs = [
		"-y",
		"skills@latest",
		"remove",
		installedName,
		"-g",
		"-a",
		"cline",
		"-y",
	];
	const displayCommand = formatCommand(command, commandArgs);
	const spawnCommand = options.spawnCommand ?? defaultMarketplaceSpawnCommand;
	let result: MarketplaceSpawnResult;
	try {
		result = await spawnCommand(command, commandArgs);
	} catch (error) {
		throw new Error(
			`Failed to start ${entry.name ?? entry.id} uninstall command:\n${displayCommand}\n${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	const output = commandOutput(result);
	if (result.exitCode !== 0) {
		throw new Error(
			`${entry.name ?? entry.id} uninstall failed with exit code ${result.exitCode}.\nCommand:\n${displayCommand}${
				output ? `\n\n${output}` : ""
			}`,
		);
	}
	if (isMarketplaceSkillInstalled(entry)) {
		throw new Error(
			`Skill uninstall completed, but ${entry.name ?? entry.id} is still present in Cline's global skills directories.`,
		);
	}
	return {
		id: entry.id,
		type: "skill",
		status: "uninstalled",
		message: `Uninstalled ${entry.name ?? entry.id}.`,
		output,
	};
}

export async function uninstallMarketplacePlugin(
	entry: MarketplaceEntryInput,
	options: Pick<UninstallMarketplaceEntryOptions, "workspaceRoot"> = {},
): Promise<MarketplaceActionResult> {
	const [source] = getMarketplaceEntryArgs(entry);
	const target = source?.trim() || entry.id;
	if (!target) {
		throw new Error("Plugin marketplace uninstalls require a plugin name.");
	}
	const result = await uninstallPlugin({
		name: target,
		workspaceRoot: options.workspaceRoot,
	});
	return {
		id: entry.id,
		type: "plugin",
		status: "uninstalled",
		message: `Uninstalled ${entry.name ?? result.name ?? entry.id}.`,
		output: [
			`Path: ${result.installPath}`,
			...result.removedPaths.map((path) => `Removed: ${path}`),
		].join("\n"),
	};
}

export async function uninstallMarketplaceEntry(
	entry: MarketplaceEntryInput,
	options: UninstallMarketplaceEntryOptions = {},
): Promise<MarketplaceActionResult> {
	if (entry.type === "mcp") {
		const name = resolveMarketplaceMcpServerName(entry);
		if (options.deleteMcpServer) {
			await options.deleteMcpServer(name);
		} else {
			uninstallMarketplaceMcpServerFromSettings(entry, options);
		}
		return {
			id: entry.id,
			type: entry.type,
			status: "uninstalled",
			message: `Uninstalled ${entry.name ?? name ?? entry.id}.`,
		};
	}
	if (entry.type === "skill") {
		return uninstallMarketplaceSkill(entry, options);
	}
	if (entry.type === "plugin") {
		return uninstallMarketplacePlugin(entry, options);
	}
	throw new Error(`Unsupported marketplace entry type: ${entry.type}`);
}
