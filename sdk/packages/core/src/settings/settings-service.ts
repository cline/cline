import { existsSync } from "node:fs";
import { basename, isAbsolute, relative } from "node:path";
import {
	createUserInstructionConfigService,
	type RuleConfig,
	type SkillConfig,
	type UserInstructionConfigService,
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

async function withUserInstructionService<T>(
	input: CoreSettingsListInput,
	run: (service?: UserInstructionConfigService) => Promise<T>,
): Promise<T> {
	if (input.userInstructionService) {
		return await run(input.userInstructionService);
	}
	const workspaceRoot = resolveWorkspaceRoot(input);
	if (!workspaceRoot) {
		return await run(undefined);
	}
	const service = createUserInstructionConfigService({
		skills: { workspacePath: workspaceRoot },
		rules: { workspacePath: workspaceRoot },
		workflows: { workspacePath: workspaceRoot },
	});
	try {
		await service.start();
		return await run(service);
	} finally {
		service.stop();
	}
}

function findSkillRecord(
	service: UserInstructionConfigService | undefined,
	input: CoreSettingsToggleInput,
) {
	if (!service) {
		return undefined;
	}
	const records = service.listRecords<SkillConfig>("skill");
	if (input.id) {
		const match = records.find((record) => record.id === input.id);
		if (match) {
			return match;
		}
	}
	for (const record of records) {
		if (
			record.filePath === input.path ||
			record.item.name === input.name ||
			record.id === input.name
		) {
			return record;
		}
	}
	return undefined;
}

export class CoreSettingsService {
	async list(input: CoreSettingsListInput = {}): Promise<CoreSettingsSnapshot> {
		return await withUserInstructionService(input, async (service) => {
			const workspaceRoot = resolveWorkspaceRoot(input);
			const workflows: CoreSettingsItem[] = [];
			const rules: CoreSettingsItem[] = [];
			const skills: CoreSettingsItem[] = [];
			const tools: CoreSettingsItem[] = [];

			if (service) {
				for (const record of service.listRecords<WorkflowConfig>("workflow")) {
					const workflow = record.item;
					workflows.push({
						id: record.id,
						name: workflow.name,
						path: record.filePath,
						enabled: workflow.disabled !== true,
						kind: "workflow",
						source: detectSource(record.filePath, workspaceRoot),
						description: workflow.instructions,
						toggleable: false,
					});
				}
				for (const record of service.listRecords<RuleConfig>("rule")) {
					const rule = record.item;
					rules.push({
						id: record.id,
						name: rule.name,
						path: record.filePath,
						enabled: rule.disabled !== true,
						kind: "rule",
						source: detectSource(record.filePath, workspaceRoot),
						description: rule.instructions,
						toggleable: false,
					});
				}
				for (const record of service.listRecords<SkillConfig>("skill")) {
					const skill = record.item;
					skills.push({
						id: record.id,
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
				try {
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
				} catch {
					// Settings listing is best-effort; unreadable plugin roots should
					// not hide rules, skills, workflows, or built-in tools.
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
			return await withUserInstructionService(input, async (service) => {
				const record = findSkillRecord(service, input);
				const filePath = record?.filePath;
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
				await service?.refreshType("skill");
				return {
					snapshot: await this.list({
						...input,
						userInstructionService: service,
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
