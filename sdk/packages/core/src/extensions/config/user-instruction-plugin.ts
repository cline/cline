import type { AgentExtension, AgentTool } from "@cline/shared";
import { loadRulesForSystemPromptFromWatcher } from "../../runtime/safety/rules";
import {
	createSkillsTool,
	type SkillsExecutor,
	type SkillsExecutorWithMetadata,
} from "../tools";
import type { BuiltinSkill } from "./builtin-skills";
import { listAvailableRuntimeCommandsFromWatcher } from "./runtime-commands";
import type {
	SkillConfig,
	UserInstructionConfigWatcher,
} from "./user-instruction-config-loader";

type SkillsExecutorMetadataItem = {
	id: string;
	name: string;
	description?: string;
	disabled: boolean;
};

type ConfiguredSkill = SkillsExecutorMetadataItem & {
	skill: SkillConfig;
};

export interface CreateUserInstructionPluginOptions {
	watcher: UserInstructionConfigWatcher;
	watcherReady?: Promise<void>;
	includeRules?: boolean;
	includeSkills?: boolean;
	includeWorkflows?: boolean;
	registerSkillsTool?: boolean;
	allowedSkillNames?: ReadonlyArray<string>;
	builtinSkills?: ReadonlyArray<BuiltinSkill>;
}

function normalizeSkillToken(token: string): string {
	return token.trim().replace(/^\/+/, "").toLowerCase();
}

function toAllowedSkillSet(
	allowedSkillNames?: ReadonlyArray<string>,
): Set<string> | undefined {
	if (allowedSkillNames === undefined) {
		return undefined;
	}
	const normalized = allowedSkillNames
		.map(normalizeSkillToken)
		.filter((token) => token.length > 0);
	return new Set(normalized);
}

function isSkillAllowed(
	skillId: string,
	skillName: string,
	allowedSkills?: Set<string>,
): boolean {
	if (!allowedSkills) {
		return true;
	}
	const normalizedId = normalizeSkillToken(skillId);
	const normalizedName = normalizeSkillToken(skillName);
	const bareId = normalizedId.includes(":")
		? (normalizedId.split(":").at(-1) ?? normalizedId)
		: normalizedId;
	const bareName = normalizedName.includes(":")
		? (normalizedName.split(":").at(-1) ?? normalizedName)
		: normalizedName;
	return (
		allowedSkills.has(normalizedId) ||
		allowedSkills.has(normalizedName) ||
		allowedSkills.has(bareId) ||
		allowedSkills.has(bareName)
	);
}

export function getConfiguredSkillsFromWatcher(
	watcher: UserInstructionConfigWatcher,
	allowedSkillNames?: ReadonlyArray<string>,
	builtinSkills: ReadonlyArray<BuiltinSkill> = [],
): ConfiguredSkill[] {
	const allowedSkills = toAllowedSkillSet(allowedSkillNames);
	const snapshot = watcher.getSnapshot("skill");
	const configuredSkills = [...snapshot.entries()].map(([id, record]) => {
		const skill = record.item as SkillConfig;
		return {
			id,
			name: skill.name.trim(),
			description: skill.description?.trim(),
			disabled: skill.disabled === true,
			skill,
		};
	});
	const reservedTokens = new Set(
		builtinSkills.flatMap(({ id, skill }) => [
			normalizeSkillToken(id),
			normalizeSkillToken(skill.name),
		]),
	);
	return [
		...builtinSkills.map(({ id, skill }) => ({
			id,
			name: skill.name.trim(),
			description: skill.description?.trim(),
			disabled: false,
			skill,
		})),
		...configuredSkills.filter(
			({ id, name }) =>
				!reservedTokens.has(normalizeSkillToken(id)) &&
				!reservedTokens.has(normalizeSkillToken(name)),
		),
	].filter((skill) => isSkillAllowed(skill.id, skill.name, allowedSkills));
}

function listAvailableSkillNames(
	watcher: UserInstructionConfigWatcher,
	allowedSkillNames?: ReadonlyArray<string>,
	builtinSkills: ReadonlyArray<BuiltinSkill> = [],
): string[] {
	return getConfiguredSkillsFromWatcher(
		watcher,
		allowedSkillNames,
		builtinSkills,
	)
		.filter((skill) => !skill.disabled)
		.map((skill) => skill.name.trim())
		.filter((name) => name.length > 0)
		.sort((a, b) => a.localeCompare(b));
}

function resolveSkillRecord(
	watcher: UserInstructionConfigWatcher,
	requestedSkill: string,
	allowedSkillNames?: ReadonlyArray<string>,
	builtinSkills: ReadonlyArray<BuiltinSkill> = [],
): { id: string; skill: SkillConfig } | { error: string } {
	const normalized = normalizeSkillToken(requestedSkill);
	if (!normalized) {
		return { error: "Missing skill name." };
	}

	const configuredSkills = getConfiguredSkillsFromWatcher(
		watcher,
		allowedSkillNames,
		builtinSkills,
	);
	const exact = configuredSkills.find((entry) => entry.id === normalized);
	if (exact) {
		const { skill } = exact;
		if (skill.disabled === true) {
			return {
				error: `Skill "${skill.name}" is configured but disabled.`,
			};
		}
		return { id: exact.id, skill };
	}

	const bareName = normalized.includes(":")
		? (normalized.split(":").at(-1) ?? normalized)
		: normalized;
	const suffixMatches = configuredSkills.filter(({ id }) => {
		if (id === bareName) {
			return true;
		}
		return id.endsWith(`:${bareName}`);
	});
	const enabledSuffixMatches = suffixMatches.filter(
		({ skill }) => skill.disabled !== true,
	);

	if (enabledSuffixMatches.length === 1) {
		const { id, skill } = enabledSuffixMatches[0];
		return { id, skill };
	}
	if (enabledSuffixMatches.length > 1) {
		return {
			error: `Skill "${requestedSkill}" is ambiguous. Use one of: ${enabledSuffixMatches.map(({ id }) => id).join(", ")}`,
		};
	}
	if (suffixMatches.length === 1) {
		const { skill } = suffixMatches[0];
		return {
			error: `Skill "${skill.name}" is configured but disabled.`,
		};
	}
	if (suffixMatches.length > 1) {
		return {
			error: `Skill "${requestedSkill}" is ambiguous, and all matches are disabled: ${suffixMatches.map(({ id }) => id).join(", ")}`,
		};
	}

	const available = listAvailableSkillNames(
		watcher,
		allowedSkillNames,
		builtinSkills,
	);
	return {
		error:
			available.length > 0
				? `Skill "${requestedSkill}" not found. Available skills: ${available.join(", ")}`
				: "No skills are currently available.",
	};
}

export function createUserInstructionSkillsExecutor(
	watcher: UserInstructionConfigWatcher,
	watcherReady: Promise<void> = Promise.resolve(),
	allowedSkillNames?: ReadonlyArray<string>,
	builtinSkills: ReadonlyArray<BuiltinSkill> = [],
): SkillsExecutorWithMetadata {
	const runningSkills = new Set<string>();
	const executor: SkillsExecutorWithMetadata = (async (skillName, args) => {
		await watcherReady;
		const resolved = resolveSkillRecord(
			watcher,
			skillName,
			allowedSkillNames,
			builtinSkills,
		);
		if ("error" in resolved) {
			return resolved.error;
		}

		const { id, skill } = resolved;
		if (runningSkills.has(id)) {
			return `Skill "${skill.name}" is already running.`;
		}

		runningSkills.add(id);
		try {
			const trimmedArgs = args?.trim();
			const argsTag = trimmedArgs
				? `\n<command-args>${trimmedArgs}</command-args>`
				: "";
			const description = skill.description?.trim()
				? `Description: ${skill.description.trim()}\n\n`
				: "";

			return `<command-name>${skill.name}</command-name>${argsTag}\n<command-instructions>\n${description}${skill.instructions}\n</command-instructions>`;
		} finally {
			runningSkills.delete(id);
		}
	}) as SkillsExecutor;

	Object.defineProperty(executor, "configuredSkills", {
		get: () =>
			getConfiguredSkillsFromWatcher(
				watcher,
				allowedSkillNames,
				builtinSkills,
			).map(({ skill: _skill, ...metadata }) => metadata),
		enumerable: true,
		configurable: false,
	});
	return executor;
}

export function createUserInstructionPlugin(
	options: CreateUserInstructionPluginOptions,
): AgentExtension {
	const watcherReady = options.watcherReady ?? Promise.resolve();
	const capabilities = [
		options.includeRules ? "rules" : undefined,
		options.registerSkillsTool ? "tools" : undefined,
		options.includeSkills || options.includeWorkflows ? "commands" : undefined,
	].filter((value): value is "rules" | "tools" | "commands" => Boolean(value));

	return {
		name: "cline-user-instructions",
		manifest: {
			capabilities,
		},
		async setup(api) {
			await watcherReady;

			if (options.includeRules) {
				api.registerRule({
					id: "cline-user-instructions:rules",
					source: "user-instruction-watcher",
					content: () => loadRulesForSystemPromptFromWatcher(options.watcher),
				});
			}

			if (options.registerSkillsTool) {
				api.registerTool(
					createSkillsTool(
						createUserInstructionSkillsExecutor(
							options.watcher,
							watcherReady,
							options.allowedSkillNames,
							options.builtinSkills,
						),
					) as AgentTool,
				);
			}

			for (const command of listAvailableRuntimeCommandsFromWatcher(
				options.watcher,
				options.builtinSkills,
			).filter(
				(command) =>
					(command.kind === "skill" && options.includeSkills) ||
					(command.kind === "workflow" && options.includeWorkflows),
			)) {
				api.registerCommand({
					name: command.name,
					description: command.description,
					handler: (input) => {
						const trimmed = input.trim();
						return trimmed
							? `${command.instructions}\n\n${trimmed}`
							: command.instructions;
					},
				});
			}
		},
	};
}
