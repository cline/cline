import { existsSync } from "node:fs";
import {
	createAgentConfigWatcher,
	listHookConfigFiles,
	type UserInstructionConfigWatcher,
} from "@clinebot/core";

export type InteractiveConfigTab =
	| "workflows"
	| "rules"
	| "skills"
	| "hooks"
	| "agents";

export interface InteractiveConfigItem {
	id: string;
	name: string;
	path: string;
	enabled?: boolean;
	source: "global" | "workspace";
	description?: string;
}

export interface InteractiveConfigData {
	workflows: InteractiveConfigItem[];
	rules: InteractiveConfigItem[];
	skills: InteractiveConfigItem[];
	hooks: InteractiveConfigItem[];
	agents: InteractiveConfigItem[];
}

function detectSource(
	path: string,
	workspaceRoot: string,
): "global" | "workspace" {
	if (!workspaceRoot) {
		return "global";
	}
	return path.startsWith(workspaceRoot) ? "workspace" : "global";
}

function toSorted<T extends InteractiveConfigItem>(items: T[]): T[] {
	return [...items].sort((a, b) => {
		if (a.source !== b.source) {
			return a.source === "workspace" ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
}

export async function loadInteractiveConfigData(input: {
	watcher?: UserInstructionConfigWatcher;
	cwd: string;
	workspaceRoot: string;
}): Promise<InteractiveConfigData> {
	const workflows: InteractiveConfigItem[] = [];
	const rules: InteractiveConfigItem[] = [];
	const skills: InteractiveConfigItem[] = [];
	const hooks: InteractiveConfigItem[] = [];
	const agents: InteractiveConfigItem[] = [];

	if (input.watcher) {
		for (const [id, record] of input.watcher
			.getSnapshot("workflow")
			.entries()) {
			const workflow = record.item;
			workflows.push({
				id,
				name: workflow.name,
				path: record.filePath,
				enabled: workflow.disabled !== true,
				source: detectSource(record.filePath, input.workspaceRoot),
				description: workflow.instructions,
			});
		}
		for (const [id, record] of input.watcher.getSnapshot("rule").entries()) {
			const rule = record.item;
			rules.push({
				id,
				name: rule.name,
				path: record.filePath,
				enabled: rule.disabled !== true,
				source: detectSource(record.filePath, input.workspaceRoot),
				description: rule.instructions,
			});
		}
		for (const [id, record] of input.watcher.getSnapshot("skill").entries()) {
			const skill = record.item as {
				name: string;
				disabled?: boolean;
				description?: string;
			};
			skills.push({
				id,
				name: skill.name,
				path: record.filePath,
				enabled: skill.disabled !== true,
				source: detectSource(record.filePath, input.workspaceRoot),
				description: skill.description,
			});
		}
	}

	for (const hook of listHookConfigFiles(input.cwd)) {
		hooks.push({
			id: hook.path,
			name: hook.fileName,
			path: hook.path,
			enabled: true,
			source: detectSource(hook.path, input.workspaceRoot),
			description: hook.hookEventName,
		});
	}

	const agentWatcher = createAgentConfigWatcher();
	try {
		await agentWatcher.start();
		for (const [id, record] of agentWatcher.getSnapshot("agent").entries()) {
			const agent = record.item;
			agents.push({
				id,
				name: agent.name,
				path: record.filePath,
				enabled: true,
				source: detectSource(record.filePath, input.workspaceRoot),
				description: agent.description,
			});
		}
	} catch {
		// Best effort: keep agents empty when watcher initialization fails.
	} finally {
		agentWatcher.stop();
	}

	return {
		workflows: toSorted(workflows.filter((item) => existsSync(item.path))),
		rules: toSorted(rules.filter((item) => existsSync(item.path))),
		skills: toSorted(skills.filter((item) => existsSync(item.path))),
		hooks: toSorted(hooks.filter((item) => existsSync(item.path))),
		agents: toSorted(agents.filter((item) => existsSync(item.path))),
	};
}
