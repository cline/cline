import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
	/** @deprecated Ignored: marketplace skills are removed in-process. */
	spawnCommand?: MarketplaceSpawnCommand;
	workspaceRoot?: string;
};

function getMarketplaceEntryArgs(entry: MarketplaceEntryInput): string[] {
	return entry.install?.args ?? [];
}

function resolveHomeDir(): string {
	return (
		process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir()
	);
}

function trimSkillSegmentEdges(value: string): string {
	let start = 0;
	let end = value.length;
	while (start < end && (value[start] === "." || value[start] === "-")) {
		start++;
	}
	while (end > start && (value[end - 1] === "." || value[end - 1] === "-")) {
		end--;
	}
	return value.slice(start, end);
}

function sanitizeSkillSegment(value: string): string {
	const sanitized = trimSkillSegmentEdges(
		value.toLowerCase().replace(/[^a-z0-9._]+/g, "-"),
	).slice(0, 255);
	return sanitized || "skill";
}

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

function removeRemainingMarketplaceSkillPaths(
	entry: MarketplaceEntryInput,
): string[] {
	const removedPaths: string[] = [];
	if (entry.type !== "skill") return removedPaths;
	for (const candidate of getMarketplaceSkillCandidates(entry)) {
		for (const skillPath of getGlobalMarketplaceSkillPaths(candidate)) {
			if (!existsSync(skillPath)) continue;
			const skillDir = dirname(skillPath);
			rmSync(skillDir, { recursive: true, force: true });
			removedPaths.push(skillDir);
		}
	}
	return removedPaths;
}

// Skills installed by the skills CLI (the marketplace's previous installer)
// have an entry in its lock file; drop it so that CLI doesn't keep offering
// updates for a skill that is gone.
function removeSkillsCliLockEntries(names: string[]): void {
	const stateHome = process.env.XDG_STATE_HOME?.trim();
	const lockPath = stateHome
		? join(stateHome, "skills", ".skill-lock.json")
		: join(resolveHomeDir(), ".agents", ".skill-lock.json");
	try {
		if (!existsSync(lockPath)) return;
		const lock = JSON.parse(readFileSync(lockPath, "utf8"));
		const skills = lock?.skills;
		if (!skills || typeof skills !== "object") return;
		const present = names.filter((name) => name in skills);
		if (present.length === 0) return;
		for (const name of present) delete skills[name];
		writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8");
	} catch {
		// The lock file belongs to another tool; a stale entry is harmless.
	}
}

export async function uninstallMarketplaceSkill(
	entry: MarketplaceEntryInput,
	_options: Pick<UninstallMarketplaceEntryOptions, "spawnCommand"> = {},
): Promise<MarketplaceActionResult> {
	if (!isMarketplaceSkillInstalled(entry)) {
		return {
			id: entry.id,
			type: "skill",
			status: "uninstalled",
			message: `${entry.name ?? entry.id} is not installed.`,
		};
	}
	const removedPaths = removeRemainingMarketplaceSkillPaths(entry);
	removeSkillsCliLockEntries(getMarketplaceSkillCandidates(entry));
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
		output:
			removedPaths.map((path) => `Removed: ${path}`).join("\n") || undefined,
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
