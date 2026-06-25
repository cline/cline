import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
	dirname,
	extname,
	isAbsolute,
	join,
	basename as pathBasename,
	relative,
	resolve,
} from "node:path";
import {
	createUserInstructionConfigService,
	discoverPluginModulePaths,
	getCoreBuiltinToolCatalog,
	listHookConfigFiles,
	listPluginTools,
	readGlobalSettings,
	resolvePluginConfigSearchPaths,
	resolveAgentConfigSearchPaths as resolveSharedAgentConfigSearchPaths,
} from "@cline/core";
import { readMcpServersResponse } from "./mcp";
import type { JsonRecord } from "./types";

function resolveAgentConfigSearchPaths(workspaceRoot?: string): string[] {
	return resolveSharedAgentConfigSearchPaths(workspaceRoot);
}

function readPackageName(packageJsonPath: string): string | undefined {
	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			name?: unknown;
		};
		return typeof packageJson.name === "string" && packageJson.name.trim()
			? packageJson.name.trim()
			: undefined;
	} catch {
		return undefined;
	}
}

function isPathWithin(parentPath: string, childPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath));
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

function getPluginDisplayName(filePath: string, searchRoot: string): string {
	let current = dirname(filePath);
	const root = resolve(searchRoot);
	while (isPathWithin(root, current)) {
		const packageJsonPath = join(current, "package.json");
		if (existsSync(packageJsonPath)) {
			const packageName = readPackageName(packageJsonPath);
			if (packageName) {
				return packageName;
			}
			break;
		}
		const parent = resolve(current, "..");
		if (parent === current) {
			break;
		}
		current = parent;
	}
	return pathBasename(filePath, extname(filePath));
}

export async function listUserInstructionConfigs(
	targetWorkspaceRoot: string,
): Promise<JsonRecord> {
	const warnings: string[] = [];

	const loadUserInstructionSnapshot = async (
		type: "rule" | "skill" | "workflow",
	): Promise<unknown[]> => {
		const items: unknown[] = [];
		const service = createUserInstructionConfigService({
			skills: { workspacePath: targetWorkspaceRoot },
			rules: { workspacePath: targetWorkspaceRoot },
			workflows: { workspacePath: targetWorkspaceRoot },
		});
		try {
			await service.start();
			for (const record of service.listRecords(type)) {
				const item = record.item as unknown as JsonRecord;
				if (item.disabled === true) continue;
				items.push({
					id: record.id,
					name: item.name ?? record.id,
					instructions: item.instructions,
					path: record.filePath,
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`${type}: ${message}`);
		} finally {
			service.stop();
		}
		return items;
	};

	const loadAgents = (): unknown[] => {
		const agentsById = new Map<string, { name: string; path: string }>();
		const directories = resolveAgentConfigSearchPaths(
			targetWorkspaceRoot,
		).filter((d) => existsSync(d));
		for (const directory of directories) {
			try {
				for (const entry of readdirSync(directory, { withFileTypes: true })) {
					if (!entry.isFile()) continue;
					const ext = extname(entry.name).toLowerCase();
					if (ext !== ".yml" && ext !== ".yaml") continue;
					const filePath = join(directory, entry.name);
					const raw = readFileSync(filePath, "utf8");
					const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
					const fm = fmMatch?.[1] ?? "";
					const nameMatch = fm.match(/^\s*name:\s*(.+?)\s*$/m);
					const parsedName = nameMatch?.[1]?.replace(/^["']|["']$/g, "").trim();
					const name =
						parsedName && parsedName.length > 0
							? parsedName
							: pathBasename(entry.name, ext);
					const id = name.toLowerCase();
					if (!agentsById.has(id)) {
						agentsById.set(id, { name, path: filePath });
					}
				}
			} catch {
				// best-effort
			}
		}
		return [...agentsById.values()].sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	};

	const loadHooks = (): unknown[] => {
		try {
			return listHookConfigFiles(targetWorkspaceRoot);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`hooks: ${message}`);
			return [];
		}
	};

	const loadPlugins = (): Array<{
		name: string;
		path: string;
		enabled: boolean;
	}> => {
		const disabledPlugins = new Set(readGlobalSettings().disabledPlugins ?? []);
		const pluginsByPath = new Map<
			string,
			{ name: string; path: string; enabled: boolean }
		>();
		const directories = resolvePluginConfigSearchPaths(
			targetWorkspaceRoot,
		).filter((d) => existsSync(d));
		for (const directory of directories) {
			try {
				for (const filePath of discoverPluginModulePaths(directory)) {
					if (pluginsByPath.has(filePath)) continue;
					pluginsByPath.set(filePath, {
						name: getPluginDisplayName(filePath, directory),
						path: filePath,
						enabled: !disabledPlugins.has(filePath),
					});
				}
			} catch {
				// best-effort
			}
		}
		return [...pluginsByPath.values()].sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	};

	const [rules, workflows, skills, pluginTools] = await Promise.all([
		loadUserInstructionSnapshot("rule"),
		loadUserInstructionSnapshot("workflow"),
		loadUserInstructionSnapshot("skill"),
		listPluginTools({
			workspacePath: targetWorkspaceRoot,
			cwd: targetWorkspaceRoot,
		}),
	]);
	const disabledTools = new Set(readGlobalSettings().disabledTools ?? []);
	const builtinToolCatalog = getCoreBuiltinToolCatalog({
		disabledToolIds: disabledTools,
	});

	return {
		workspaceRoot: targetWorkspaceRoot,
		rules,
		workflows,
		skills,
		agents: loadAgents(),
		plugins: loadPlugins(),
		tools: [
			...builtinToolCatalog.map((tool) => ({
				id: tool.id,
				name: tool.id,
				description: tool.description,
				enabled:
					tool.defaultEnabled &&
					!tool.headlessToolNames.some((name) => disabledTools.has(name)),
				source: "builtin",
				headlessToolNames: tool.headlessToolNames,
			})),
			...pluginTools.map((tool) => ({
				id: `${tool.pluginName}:${tool.name}:${tool.path}`,
				name: tool.name,
				description: tool.description,
				enabled: tool.enabled,
				source: tool.source,
				path: tool.path,
				pluginName: tool.pluginName,
			})),
		],
		hooks: loadHooks(),
		mcp: readMcpServersResponse(),
		warnings,
	};
}
