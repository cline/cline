import type { LlmsProviders } from "@clinebot/llms";

const DEFAULT_MAX_TOOL_RESULT_CHARS = 50_000;
const TARGET_TOOL_NAMES = new Set([
	"read",
	"read_files",
	"bash",
	"run_commands",
]);
const READ_TOOL_NAMES = new Set(["read", "read_files"]);
const KEEP_CHARS_PER_SIDE = 50_000;
const OUTDATED_FILE_CONTENT = "[outdated - see the latest file content]";

interface ReadResultRecord {
	toolUseId: string;
	paths: string[];
}

/**
 * Builds an API-safe message copy without mutating original conversation history.
 */
export class MessageBuilder {
	private indexedMessageCount = 0;
	private indexedTailRef: LlmsProviders.Message | undefined;
	private readonly toolNameByIdCache = new Map<string, string>();
	private readonly readPathsByToolUseIdCache = new Map<string, string[]>();
	private readonly latestReadToolUseByPathCache = new Map<string, string>();
	private readResultPathCache = new WeakMap<object, string[]>();

	constructor(
		private readonly maxToolResultChars = DEFAULT_MAX_TOOL_RESULT_CHARS,
		private readonly targetToolNames = TARGET_TOOL_NAMES,
	) {}

	buildForApi(messages: LlmsProviders.Message[]): LlmsProviders.Message[] {
		this.reindex(messages);
		const toolNameById = this.toolNameByIdCache;
		const readPathsByToolUseId = this.readPathsByToolUseIdCache;
		const latestReadToolUseByPath = this.latestReadToolUseByPathCache;

		return messages.map((message) => {
			if (!Array.isArray(message.content)) {
				return message;
			}

			const content = message.content.map((block) => {
				if (block.type === "file") {
					const truncated = this.truncateMiddle(block.content);
					if (truncated === block.content) {
						return block;
					}
					return {
						...block,
						content: truncated,
					};
				}

				if (block.type !== "tool_result") {
					return block;
				}

				const toolName = toolNameById.get(block.tool_use_id);
				let nextContent = block.content;

				if (this.isReadTool(toolName)) {
					const readRecord = this.getReadResultRecord(
						block,
						readPathsByToolUseId.get(block.tool_use_id),
					);
					if (readRecord) {
						const outdatedPaths = readRecord.paths.filter(
							(path) => latestReadToolUseByPath.get(path) !== block.tool_use_id,
						);
						if (outdatedPaths.length > 0) {
							nextContent = this.replaceOutdatedReadContent(
								nextContent,
								outdatedPaths,
							);
						}
					}
				}

				if (this.shouldTruncateTool(toolName)) {
					nextContent = this.truncateToolResultContent(nextContent);
				}

				if (nextContent === block.content) {
					return block;
				}

				return {
					...block,
					content: nextContent,
				};
			});

			return {
				role: message.role,
				content,
			};
		});
	}

	private reindex(messages: LlmsProviders.Message[]): void {
		if (messages.length < this.indexedMessageCount) {
			this.resetIndexes();
		}
		if (
			this.indexedMessageCount > 0 &&
			messages.length >= this.indexedMessageCount &&
			messages[this.indexedMessageCount - 1] !== this.indexedTailRef
		) {
			this.resetIndexes();
		}

		for (let i = this.indexedMessageCount; i < messages.length; i++) {
			const message = messages[i];
			if (!Array.isArray(message.content)) {
				continue;
			}

			for (const block of message.content) {
				if (block.type === "tool_use") {
					const normalizedName = block.name.toLowerCase();
					this.toolNameByIdCache.set(block.id, normalizedName);
					if (this.isReadTool(normalizedName)) {
						const paths = this.extractPathsFromReadToolInput(block.input);
						if (paths.length > 0) {
							this.readPathsByToolUseIdCache.set(block.id, paths);
						}
					}
					continue;
				}
				if (block.type === "tool_result") {
					const toolName = this.toolNameByIdCache.get(block.tool_use_id);
					if (!this.isReadTool(toolName)) {
						continue;
					}
					const readRecord = this.getReadResultRecord(
						block,
						this.readPathsByToolUseIdCache.get(block.tool_use_id),
					);
					if (!readRecord) {
						continue;
					}
					for (const path of readRecord.paths) {
						this.latestReadToolUseByPathCache.set(path, readRecord.toolUseId);
					}
				}
			}
		}
		this.indexedMessageCount = messages.length;
		this.indexedTailRef =
			messages.length > 0 ? messages[messages.length - 1] : undefined;
	}

	private resetIndexes(): void {
		this.indexedMessageCount = 0;
		this.indexedTailRef = undefined;
		this.toolNameByIdCache.clear();
		this.readPathsByToolUseIdCache.clear();
		this.latestReadToolUseByPathCache.clear();
		this.readResultPathCache = new WeakMap<object, string[]>();
	}

	private getReadResultRecord(
		block: LlmsProviders.ToolResultContent,
		fallbackPaths: string[] | undefined,
	): ReadResultRecord | undefined {
		const blockRef = block as unknown as object;
		const cachedParsedPaths = this.readResultPathCache.get(blockRef);
		const parsedPaths =
			cachedParsedPaths ??
			this.extractReadPathsFromToolResultContent(block.content);
		if (!cachedParsedPaths) {
			this.readResultPathCache.set(blockRef, parsedPaths);
		}
		const paths = parsedPaths.length > 0 ? parsedPaths : (fallbackPaths ?? []);
		if (paths.length === 0) {
			return undefined;
		}

		return {
			toolUseId: block.tool_use_id,
			paths,
		};
	}

	private extractPathsFromReadToolInput(
		input: Record<string, unknown>,
	): string[] {
		const paths: string[] = [];
		const maybePath = input.path;
		const maybeFilePath = input.file_path;
		const maybeFilePaths = input.file_paths;

		if (typeof maybePath === "string" && maybePath.length > 0) {
			paths.push(maybePath);
		}
		if (typeof maybeFilePath === "string" && maybeFilePath.length > 0) {
			paths.push(maybeFilePath);
		}
		if (Array.isArray(maybeFilePaths)) {
			for (const value of maybeFilePaths) {
				if (typeof value === "string" && value.length > 0) {
					paths.push(value);
				}
			}
		}

		return Array.from(new Set(paths));
	}

	private extractReadPathsFromToolResultContent(
		content: LlmsProviders.ToolResultContent["content"],
	): string[] {
		if (typeof content !== "string") {
			return [];
		}

		try {
			const parsed = JSON.parse(content);
			return this.extractPathsFromParsedReadResult(parsed);
		} catch {
			return [];
		}
	}

	private extractPathsFromParsedReadResult(value: unknown): string[] {
		if (Array.isArray(value)) {
			const paths = value
				.map((item) => this.extractPathFromResultEntry(item))
				.filter(
					(path): path is string => typeof path === "string" && path.length > 0,
				);
			return Array.from(new Set(paths));
		}

		const path = this.extractPathFromResultEntry(value);
		return path ? [path] : [];
	}

	private extractPathFromResultEntry(value: unknown): string | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}

		const record = value as Record<string, unknown>;
		const candidates = [
			record.path,
			record.file_path,
			record.filePath,
			record.query,
		];
		for (const candidate of candidates) {
			if (typeof candidate === "string" && candidate.length > 0) {
				return candidate;
			}
		}

		return undefined;
	}

	private replaceOutdatedReadContent(
		content: LlmsProviders.ToolResultContent["content"],
		outdatedPaths: string[],
	): LlmsProviders.ToolResultContent["content"] {
		const outdatedPathSet = new Set(outdatedPaths);

		if (typeof content === "string") {
			const replaced = this.replaceOutdatedReadContentInString(
				content,
				outdatedPathSet,
			);
			return replaced ?? OUTDATED_FILE_CONTENT;
		}

		return content.map((entry) => {
			if (entry.type === "file") {
				if (!outdatedPathSet.has(entry.path)) {
					return entry;
				}
				return {
					...(entry as LlmsProviders.FileContent),
					content: OUTDATED_FILE_CONTENT,
				};
			}

			if (entry.type !== "text") {
				return entry;
			}
			const replaced = this.replaceOutdatedReadContentInString(
				entry.text,
				outdatedPathSet,
			);
			if (replaced === null) {
				return {
					...(entry as LlmsProviders.TextContent),
					text: OUTDATED_FILE_CONTENT,
				};
			}
			if (replaced === entry.text) {
				return entry;
			}
			return {
				...(entry as LlmsProviders.TextContent),
				text: replaced,
			};
		});
	}

	private replaceOutdatedReadContentInString(
		text: string,
		outdatedPathSet: Set<string>,
	): string | null {
		try {
			const parsed = JSON.parse(text);
			const replaced = this.replaceOutdatedReadContentInParsed(
				parsed,
				outdatedPathSet,
			);
			return JSON.stringify(replaced);
		} catch {
			return null;
		}
	}

	private replaceOutdatedReadContentInParsed(
		value: unknown,
		outdatedPathSet: Set<string>,
	): unknown {
		if (Array.isArray(value)) {
			return value.map((entry) =>
				this.replaceOutdatedReadEntry(entry, outdatedPathSet),
			);
		}

		return this.replaceOutdatedReadEntry(value, outdatedPathSet);
	}

	private replaceOutdatedReadEntry(
		entry: unknown,
		outdatedPathSet: Set<string>,
	): unknown {
		if (!entry || typeof entry !== "object") {
			return entry;
		}

		const record = { ...(entry as Record<string, unknown>) };
		const path = this.extractPathFromResultEntry(record);
		if (!path || !outdatedPathSet.has(path)) {
			return entry;
		}

		if (typeof record.result === "string") {
			record.result = OUTDATED_FILE_CONTENT;
		} else if (typeof record.content === "string") {
			record.content = OUTDATED_FILE_CONTENT;
		} else {
			record.result = OUTDATED_FILE_CONTENT;
		}

		return record;
	}

	private isReadTool(toolName: string | undefined): boolean {
		if (!toolName) {
			return false;
		}
		return READ_TOOL_NAMES.has(toolName.toLowerCase());
	}

	private shouldTruncateTool(toolName: string | undefined): boolean {
		if (!toolName) {
			return false;
		}
		return this.targetToolNames.has(toolName.toLowerCase());
	}

	private truncateToolResultContent(
		content: LlmsProviders.ToolResultContent["content"],
	): LlmsProviders.ToolResultContent["content"] {
		if (typeof content === "string") {
			return this.truncateMiddle(content);
		}

		return content.map((entry) => {
			if (entry.type === "file") {
				const fileContent = this.truncateMiddle(entry.content);
				if (fileContent === entry.content) {
					return entry;
				}
				return {
					...(entry as LlmsProviders.FileContent),
					content: fileContent,
				};
			}

			if (entry.type !== "text") {
				return entry;
			}

			const text = this.truncateMiddle(entry.text);
			if (text === entry.text) {
				return entry;
			}

			return {
				...(entry as LlmsProviders.TextContent),
				text,
			};
		});
	}

	private truncateMiddle(text: string): string {
		if (text.length <= this.maxToolResultChars) {
			return text;
		}

		const retainedChars = KEEP_CHARS_PER_SIDE * 2;
		const removedChars = Math.max(0, text.length - retainedChars);
		const marker = `\n\n...[truncated ${removedChars} chars]...\n\n`;

		const start = text.slice(0, KEEP_CHARS_PER_SIDE);
		const end = text.slice(-KEEP_CHARS_PER_SIDE);

		return `${start}${marker}${end}`;
	}
}
