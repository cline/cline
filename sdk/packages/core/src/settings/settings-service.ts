import { existsSync } from "node:fs";
import { basename, isAbsolute, relative } from "node:path";
import {
	createUserInstructionConfigWatcher,
	type RuleConfig,
	type SkillConfig,
	type UserInstructionConfigWatcher,
	type WorkflowConfig,
} from "../extensions/config";
import { toggleSkillFrontmatter } from "../extensions/config/skill-frontmatter-toggle";
import {
	setToolDisabledGlobally,
	toggleDisabledTool,
} from "../services/global-settings";
import { listPluginTools } from "../services/plugin-tools";
import type {
	CoreSettingsItem,
	CoreSettingsListInput,
	CoreSettingsMutationResult,
	CoreSettingsSnapshot,
	CoreSettingsToggleInput,
} from "./types";

function detectSource(
	filePath: string,
	workspaceRoot: string,
): "global" | "workspace" {
	if (!workspaceRoot) {
		return "global";
	}
	const relativePath = relative(workspaceRoot, filePath);
	return !relativePath.startsWith("..") && !isAbsolute(relativePath)
		? "workspace"
		: "global";
}

function toSorted<T extends CoreSettingsItem>(items: T[]): T[] {
	return [...items].sort((a, b) => {
		const sourceRank = (source: CoreSettingsItem["source"]): number => {
			switch (source) {
				case "workspace":
				case "workspace-plugin":
					return 0;
				case "global":
				case "global-plugin":
					return 1;
				case "builtin":
					return 2;
			}
		};
		if (a.source !== b.source) {
			return sourceRank(a.source) - sourceRank(b.source);
		}
		return a.name.localeCompare(b.name);
	});
}

function resolveWorkspaceRoot(input: CoreSettingsListInput): string {
	return input.workspaceRoot?.trim() || input.cwd?.trim() || "";
}

async function withInstructionWatcher<T>(
	input: CoreSettingsListInput,
	run: (watcher?: UserInstructionConfigWatcher) => Promise<T>,
): Promise<T> {
	if (input.userInstructionWatcher) {
		return await run(input.userInstructionWatcher);
	}
	const workspaceRoot = resolveWorkspaceRoot(input);
	if (!workspaceRoot) {
		return await run(undefined);
	}
	const watcher = createUserInstructionConfigWatcher({
		skills: { workspacePath: workspaceRoot },
		rules: { workspacePath: workspaceRoot },
		workflows: { workspacePath: workspaceRoot },
	});
	try {
		await watcher.start();
		return await run(watcher);
	} finally {
		watcher.stop();
	}
}

function findSkillRecord(
	watcher: UserInstructionConfigWatcher | undefined,
	input: CoreSettingsToggleInput,
) {
	if (!watcher) {
		return undefined;
	}
	const records = watcher.getSnapshot("skill");
	if (input.id && records.has(input.id)) {
		return records.get(input.id);
	}
	for (const [id, record] of records.entries()) {
		if (
			record.filePath === input.path ||
			record.item.name === input.name ||
			id === input.name
		) {
			return record;
		}
	}
	return undefined;
}

export class CoreSettingsService {
	async list(input: CoreSettingsListInput = {}): Promise<CoreSettingsSnapshot> {
		return await withInstructionWatcher(input, async (watcher) => {
			const workspaceRoot = resolveWorkspaceRoot(input);
			const workflows: CoreSettingsItem[] = [];
			const rules: CoreSettingsItem[] = [];
			const skills: CoreSettingsItem[] = [];
			const tools: CoreSettingsItem[] = [];

			if (watcher) {
				for (const [id, record] of watcher.getSnapshot("workflow").entries()) {
					const workflow = record.item as WorkflowConfig;
					workflows.push({
						id,
						name: workflow.name,
						path: record.filePath,
						enabled: workflow.disabled !== true,
						kind: "workflow",
						source: detectSource(record.filePath, workspaceRoot),
						description: workflow.instructions,
						toggleable: false,
					});
				}
				for (const [id, record] of watcher.getSnapshot("rule").entries()) {
					const rule = record.item as RuleConfig;
					rules.push({
						id,
						name: rule.name,
						path: record.filePath,
						enabled: rule.disabled !== true,
						kind: "rule",
						source: detectSource(record.filePath, workspaceRoot),
						description: rule.instructions,
						toggleable: false,
					});
				}
				for (const [id, record] of watcher.getSnapshot("skill").entries()) {
					const skill = record.item as SkillConfig;
					skills.push({
						id,
						name: skill.name,
						path: record.filePath,
						enabled: skill.disabled !== true,
						kind: "skill",
						source: detectSource(record.filePath, workspaceRoot),
						description: skill.description,
						toggleable: true,
					});
				}
			}

			if (workspaceRoot) {
				for (const pluginTool of await listPluginTools({
					workspacePath: workspaceRoot,
					cwd: input.cwd,
					providerId: input.availabilityContext?.providerId,
					modelId: input.availabilityContext?.modelId,
				})) {
					tools.push({
						id: `${pluginTool.pluginName}:${pluginTool.name}:${pluginTool.path}`,
						name: pluginTool.name,
						path: pluginTool.path,
						enabled: pluginTool.enabled,
						kind: "tool",
						source: pluginTool.source,
						description: pluginTool.description,
						toggleable: true,
					});
				}
			}

			return {
				workflows: toSorted(workflows.filter((item) => existsSync(item.path))),
				rules: toSorted(rules.filter((item) => existsSync(item.path))),
				skills: toSorted(skills.filter((item) => existsSync(item.path))),
				tools: toSorted(tools),
			};
		});
	}

	async toggle(
		input: CoreSettingsToggleInput,
	): Promise<CoreSettingsMutationResult> {
		if (input.type === "skills") {
			return await withInstructionWatcher(input, async (watcher) => {
				const record =
					input.path?.trim() && input.enabled !== undefined
						? undefined
						: findSkillRecord(watcher, input);
				const filePath = input.path?.trim() || record?.filePath;
				if (!filePath) {
					throw new Error(
						`Unable to resolve skill setting '${input.id ?? input.name ?? basename(input.path ?? "")}'.`,
					);
				}
				const currentEnabled =
					record?.item && "disabled" in record.item
						? (record.item as SkillConfig).disabled !== true
						: undefined;
				const enabled =
					input.enabled ??
					(currentEnabled !== undefined ? !currentEnabled : undefined);
				if (enabled === undefined) {
					throw new Error(
						`Cannot determine toggle state for skill '${input.id ?? input.name ?? basename(input.path ?? "")}'; provide an explicit enabled value or a resolvable workspace context.`,
					);
				}
				await toggleSkillFrontmatter({ filePath, enabled });
				await watcher?.refreshType("skill");
				return {
					snapshot: await this.list({
						...input,
						userInstructionWatcher: watcher,
					}),
					changedTypes: ["skills"],
				};
			});
		}

		if (input.type === "tools") {
			if (!input.name?.trim()) {
				throw new Error("Tool settings toggle requires a tool name.");
			}
			if (input.enabled === undefined) {
				toggleDisabledTool(input.name);
			} else {
				setToolDisabledGlobally(input.name, !input.enabled);
			}
			return {
				snapshot: await this.list(input),
				changedTypes: ["tools"],
			};
		}

		throw new Error(`Settings type '${input.type}' does not support toggles.`);
	}
}

export function createCoreSettingsService(): CoreSettingsService {
	return new CoreSettingsService();
}
