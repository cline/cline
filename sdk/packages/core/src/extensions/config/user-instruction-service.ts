import type { AgentExtension, AgentTool } from "@cline/shared";
import { formatRulesForSystemPrompt } from "../../runtime/safety/rules";
import { createSkillsTool, type SkillsExecutorWithMetadata } from "../tools";
import {
	type AvailableRuntimeCommand,
	listAvailableRuntimeCommandsFromWatcher,
	normalizeRuntimeCommandName,
	type ResolveRuntimeSlashCommandOptions,
	resolveRuntimeSlashCommandFromWatcher,
} from "./runtime-commands";
import {
	type CreateUserInstructionConfigWatcherOptions,
	createUserInstructionConfigWatcher,
	type RuleConfig,
	type UserInstructionConfig,
	type UserInstructionConfigType,
	type UserInstructionConfigWatcher,
} from "./user-instruction-config-loader";
import {
	type CreateUserInstructionPluginOptions,
	createUserInstructionPlugin,
	createUserInstructionSkillsExecutor,
	getConfiguredSkillsFromWatcher,
} from "./user-instruction-plugin";

export interface UserInstructionConfigRecord<
	TConfig extends UserInstructionConfig = UserInstructionConfig,
> {
	type: UserInstructionConfigType;
	id: string;
	filePath: string;
	item: TConfig;
}

export interface CreateUserInstructionConfigServiceOptions
	extends CreateUserInstructionConfigWatcherOptions {}

export interface UserInstructionConfigService {
	start(): Promise<void>;
	stop(): void;
	refreshType(type: UserInstructionConfigType): Promise<void>;
	listRecords<TConfig extends UserInstructionConfig = UserInstructionConfig>(
		type: UserInstructionConfigType,
	): UserInstructionConfigRecord<TConfig>[];
	listRuntimeCommands(): AvailableRuntimeCommand[];
	resolveRuntimeSlashCommand(
		input: string,
		options?: ResolveRuntimeSlashCommandOptions,
	): string;
	hasConfiguredSkills(allowedSkillNames?: ReadonlyArray<string>): boolean;
	createSkillsExecutor?(
		allowedSkillNames?: ReadonlyArray<string>,
	): SkillsExecutorWithMetadata;
	createExtension(
		options: Omit<
			CreateUserInstructionPluginOptions,
			"watcher" | "watcherReady"
		>,
	): AgentExtension;
}

function normalizeSkillToken(token: string): string {
	return token.trim().replace(/^\/+/, "").toLowerCase();
}

function createCombinedSkillsExecutor(
	services: ReadonlyArray<UserInstructionConfigService>,
	allowedSkillNames?: ReadonlyArray<string>,
): SkillsExecutorWithMetadata {
	const executors = services
		.map((service) => service.createSkillsExecutor?.(allowedSkillNames))
		.filter(
			(executor): executor is SkillsExecutorWithMetadata =>
				executor !== undefined,
		);
	const resolveEntries = () =>
		executors.flatMap((executor) =>
			(executor.configuredSkills ?? []).map((metadata) => ({
				metadata,
				executor,
			})),
		);
	const executor: SkillsExecutorWithMetadata = async (
		skillName,
		args,
		context,
	) => {
		const normalized = normalizeSkillToken(skillName);
		if (!normalized) {
			return "Missing skill name.";
		}
		const entries = resolveEntries();
		const exactMatches = entries.filter(
			({ metadata }) => normalizeSkillToken(metadata.id) === normalized,
		);
		const matches =
			exactMatches.length > 0
				? exactMatches
				: entries.filter(({ metadata }) => {
						const id = normalizeSkillToken(metadata.id);
						return (
							normalizeSkillToken(metadata.name) === normalized ||
							id.endsWith(`:${normalized}`)
						);
					});
		const enabled = matches.filter(({ metadata }) => !metadata.disabled);
		if (enabled.length === 1) {
			return enabled[0].executor(enabled[0].metadata.id, args, context);
		}
		if (enabled.length > 1) {
			return `Skill "${skillName}" is ambiguous. Use one of: ${enabled.map(({ metadata }) => metadata.id).join(", ")}`;
		}
		if (matches.length > 0) {
			return `Skill "${skillName}" is configured but disabled.`;
		}
		const available = entries
			.filter(({ metadata }) => !metadata.disabled)
			.map(({ metadata }) => metadata.id)
			.sort((left, right) => left.localeCompare(right));
		return available.length > 0
			? `Skill "${skillName}" not found. Available skills: ${available.join(", ")}`
			: "No skills are currently available.";
	};

	Object.defineProperty(executor, "configuredSkills", {
		get: () => resolveEntries().map(({ metadata }) => metadata),
		enumerable: true,
		configurable: false,
	});
	return executor;
}

/**
 * Present multiple instruction sources as one extension/tool surface. This is
 * used by the hub to overlay host-local Agent Plugin skills on a client-owned
 * instruction snapshot without moving package discovery into each client.
 */
export function combineUserInstructionConfigServices(
	services: ReadonlyArray<UserInstructionConfigService>,
): UserInstructionConfigService {
	if (services.length === 0) {
		throw new Error("At least one user instruction service is required.");
	}
	if (services.length === 1) {
		return services[0];
	}

	const listRecords = <
		TConfig extends UserInstructionConfig = UserInstructionConfig,
	>(
		type: UserInstructionConfigType,
	): UserInstructionConfigRecord<TConfig>[] => {
		const records = new Map<string, UserInstructionConfigRecord<TConfig>>();
		for (const service of services) {
			for (const record of service.listRecords<TConfig>(type)) {
				if (!records.has(record.id)) {
					records.set(record.id, record);
				}
			}
		}
		return [...records.values()];
	};
	const listRuntimeCommands = (): AvailableRuntimeCommand[] => {
		const commands = new Map<string, AvailableRuntimeCommand>();
		for (const service of services) {
			for (const command of service.listRuntimeCommands()) {
				const normalized = normalizeRuntimeCommandName(command.name);
				if (normalized && !commands.has(normalized)) {
					commands.set(normalized, command);
				}
			}
		}
		return [...commands.values()].sort((left, right) =>
			left.name.localeCompare(right.name),
		);
	};

	return {
		start: async () => {
			await Promise.all(services.map((service) => service.start()));
		},
		stop: () => {
			for (const service of services) {
				service.stop();
			}
		},
		refreshType: async (type) => {
			await Promise.all(services.map((service) => service.refreshType(type)));
		},
		listRecords,
		listRuntimeCommands,
		resolveRuntimeSlashCommand: (input, options) => {
			for (const service of services) {
				const resolved = service.resolveRuntimeSlashCommand(input, options);
				if (resolved !== input) {
					return resolved;
				}
			}
			return input;
		},
		hasConfiguredSkills: (allowedSkillNames) =>
			services.some((service) =>
				service.hasConfiguredSkills(allowedSkillNames),
			),
		createSkillsExecutor: (allowedSkillNames) =>
			createCombinedSkillsExecutor(services, allowedSkillNames),
		createExtension: (options): AgentExtension => ({
			name: "cline-combined-user-instructions",
			manifest: {
				capabilities: [
					options.includeRules ? "rules" : undefined,
					options.registerSkillsTool ? "tools" : undefined,
					options.includeSkills || options.includeWorkflows
						? "commands"
						: undefined,
				].filter((value): value is "rules" | "tools" | "commands" =>
					Boolean(value),
				),
			},
			setup(api) {
				if (options.includeRules) {
					api.registerRule({
						id: "cline-combined-user-instructions:rules",
						source: "combined-user-instructions",
						content: () =>
							formatRulesForSystemPrompt(
								listRecords<RuleConfig>("rule")
									.map((record) => record.item)
									.filter((rule) => rule.disabled !== true),
							),
					});
				}
				if (options.registerSkillsTool) {
					api.registerTool(
						createSkillsTool(
							createCombinedSkillsExecutor(services, options.allowedSkillNames),
						) as AgentTool,
					);
				}
				for (const command of listRuntimeCommands().filter(
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
		}),
	};
}

class DefaultUserInstructionConfigService
	implements UserInstructionConfigService
{
	private readonly watcher: UserInstructionConfigWatcher;
	private ready: Promise<void> | undefined;
	private stopped = false;

	constructor(options?: CreateUserInstructionConfigServiceOptions) {
		this.watcher = createUserInstructionConfigWatcher(options);
	}

	start(): Promise<void> {
		if (!this.ready) {
			this.stopped = false;
			this.ready = this.watcher.start();
		}
		return this.ready;
	}

	stop(): void {
		if (this.stopped) {
			return;
		}
		this.stopped = true;
		this.watcher.stop();
		this.ready = undefined;
	}

	async refreshType(type: UserInstructionConfigType): Promise<void> {
		await this.start();
		await this.watcher.refreshType(type);
	}

	listRecords<TConfig extends UserInstructionConfig = UserInstructionConfig>(
		type: UserInstructionConfigType,
	): UserInstructionConfigRecord<TConfig>[] {
		return [...this.watcher.getSnapshot(type).entries()].map(
			([id, record]) => ({
				type,
				id,
				filePath: record.filePath,
				item: record.item as TConfig,
			}),
		);
	}

	listRuntimeCommands(): AvailableRuntimeCommand[] {
		return listAvailableRuntimeCommandsFromWatcher(this.watcher);
	}

	resolveRuntimeSlashCommand(
		input: string,
		options?: ResolveRuntimeSlashCommandOptions,
	): string {
		return resolveRuntimeSlashCommandFromWatcher(input, this.watcher, options);
	}

	hasConfiguredSkills(allowedSkillNames?: ReadonlyArray<string>): boolean {
		return getConfiguredSkillsFromWatcher(this.watcher, allowedSkillNames).some(
			(skill) => !skill.disabled,
		);
	}

	createSkillsExecutor(
		allowedSkillNames?: ReadonlyArray<string>,
	): SkillsExecutorWithMetadata {
		return createUserInstructionSkillsExecutor(
			this.watcher,
			(this.ready ?? Promise.resolve()).catch(() => {}),
			allowedSkillNames,
		);
	}

	createExtension(
		options: Omit<
			CreateUserInstructionPluginOptions,
			"watcher" | "watcherReady"
		>,
	): AgentExtension {
		return createUserInstructionPlugin({
			...options,
			watcher: this.watcher,
			watcherReady: (this.ready ?? Promise.resolve()).catch(() => {}),
		});
	}
}

export function createUserInstructionConfigService(
	options?: CreateUserInstructionConfigServiceOptions,
): UserInstructionConfigService {
	return new DefaultUserInstructionConfigService(options);
}
