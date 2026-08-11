import { existsSync, readdirSync } from "node:fs";
import { extname, join, basename as pathBasename } from "node:path";
import {
	createCoreSettingsService,
	createUserInstructionConfigService,
	getCoreBuiltinToolCatalog,
	listHookConfigFiles,
	readGlobalSettings,
	resolveAgentConfigSearchPaths as resolveSharedAgentConfigSearchPaths,
} from "@cline/core";
import { readFileSyncStrippingUtf8Bom } from "@cline/shared/node";
import { readMcpServersResponse } from "./mcp";
import type { JsonRecord } from "./types";

function resolveAgentConfigSearchPaths(workspaceRoot?: string): string[] {
	return resolveSharedAgentConfigSearchPaths(workspaceRoot);
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
					const raw = readFileSyncStrippingUtf8Bom(filePath);
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

	const [rules, workflows, skills, settingsSnapshot] = await Promise.all([
		loadUserInstructionSnapshot("rule"),
		loadUserInstructionSnapshot("workflow"),
		loadUserInstructionSnapshot("skill"),
		createCoreSettingsService().list({
			workspaceRoot: targetWorkspaceRoot,
			cwd: targetWorkspaceRoot,
		}),
	]);
	const disabledTools = new Set(readGlobalSettings().disabledTools ?? []);
	// Pin spawn/teams availability so this listing matches the desktop
	// sidecar's (sidecar/commands.ts) even if the preset defaults change.
	const builtinToolCatalog = getCoreBuiltinToolCatalog({
		enableSpawnAgent: true,
		enableAgentTeams: true,
		disabledToolIds: disabledTools,
	});

	return {
		workspaceRoot: targetWorkspaceRoot,
		rules,
		workflows,
		skills,
		agents: loadAgents(),
		plugins: settingsSnapshot.plugins.map((plugin) => ({
			name: plugin.name,
			path: plugin.path,
			enabled: plugin.enabled !== false,
			contributions: plugin.contributions,
		})),
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
			...settingsSnapshot.tools.map((tool) => ({
				id: tool.id,
				name: tool.name,
				description: tool.description,
				enabled: tool.enabled !== false,
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
