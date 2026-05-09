import type { AgentExtension } from "@clinebot/shared";
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
	createExtension(
		options: Omit<
			CreateUserInstructionPluginOptions,
			"watcher" | "watcherReady"
		>,
	): AgentExtension;
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

	resolveRuntimeSlashCommand(input: string): string {
		return resolveRuntimeSlashCommandFromWatcher(input, this.watcher);
	}

	hasConfiguredSkills(allowedSkillNames?: ReadonlyArray<string>): boolean {
		return (
			getConfiguredSkillsFromWatcher(this.watcher, allowedSkillNames).length > 0
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
