import type { AgentExtension } from "@cline/shared";
import type { SkillsExecutorWithMetadata } from "../tools";
import { type BuiltinSkill, listBuiltinSkills } from "./builtin-skills";
import {
	type AvailableRuntimeCommand,
	listAvailableRuntimeCommandsFromWatcher,
	resolveRuntimeSlashCommandFromWatcher,
} from "./runtime-commands";
import {
	type CreateUserInstructionConfigWatcherOptions,
	createUserInstructionConfigWatcher,
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
	resolveRuntimeSlashCommand(input: string): string;
	hasConfiguredSkills(allowedSkillNames?: ReadonlyArray<string>): boolean;
	createSkillsExecutor?(
		allowedSkillNames?: ReadonlyArray<string>,
	): SkillsExecutorWithMetadata;
	createExtension(
		options: Omit<
			CreateUserInstructionPluginOptions,
			"watcher" | "watcherReady" | "builtinSkills"
		>,
	): AgentExtension;
}

class DefaultUserInstructionConfigService
	implements UserInstructionConfigService
{
	private readonly watcher: UserInstructionConfigWatcher;
	private ready: Promise<void> | undefined;
	private stopped = false;
	private readonly workspacePath: string | undefined;

	constructor(options?: CreateUserInstructionConfigServiceOptions) {
		this.watcher = createUserInstructionConfigWatcher(options);
		this.workspacePath = options?.skills?.workspacePath;
	}

	private builtinSkills(): BuiltinSkill[] {
		return listBuiltinSkills(this.workspacePath);
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
		return listAvailableRuntimeCommandsFromWatcher(
			this.watcher,
			this.builtinSkills(),
		);
	}

	resolveRuntimeSlashCommand(input: string): string {
		return resolveRuntimeSlashCommandFromWatcher(
			input,
			this.watcher,
			this.builtinSkills(),
		);
	}

	hasConfiguredSkills(allowedSkillNames?: ReadonlyArray<string>): boolean {
		return getConfiguredSkillsFromWatcher(
			this.watcher,
			allowedSkillNames,
			this.builtinSkills(),
		).some((skill) => !skill.disabled);
	}

	createSkillsExecutor(
		allowedSkillNames?: ReadonlyArray<string>,
	): SkillsExecutorWithMetadata {
		return createUserInstructionSkillsExecutor(
			this.watcher,
			(this.ready ?? Promise.resolve()).catch(() => {}),
			allowedSkillNames,
			this.builtinSkills(),
		);
	}

	createExtension(
		options: Omit<
			CreateUserInstructionPluginOptions,
			"watcher" | "watcherReady" | "builtinSkills"
		>,
	): AgentExtension {
		return createUserInstructionPlugin({
			...options,
			watcher: this.watcher,
			watcherReady: (this.ready ?? Promise.resolve()).catch(() => {}),
			builtinSkills: this.builtinSkills(),
		});
	}
}

export function createUserInstructionConfigService(
	options?: CreateUserInstructionConfigServiceOptions,
): UserInstructionConfigService {
	return new DefaultUserInstructionConfigService(options);
}
