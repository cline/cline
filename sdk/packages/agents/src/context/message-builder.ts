import type * as LlmsProviders from "@clinebot/llms";

const DEFAULT_MAX_TOOL_RESULT_CHARS = 50_000;
const TARGET_TOOL_NAMES = new Set([
	"read",
	"read_files",
	"search",
	"search_codebase",
	"bash",
	"run_commands",
]);
const READ_TOOL_NAMES = new Set(["read", "read_files"]);
const OUTDATED_FILE_CONTENT = "[outdated - see the latest file content]";

interface ReadResultRecord {
	toolUseId: string;
	locators: ReadLocator[];
}

interface ReadLocator {
	path: string;
	startLine: number | null;
	endLine: number | null;
}

/**
 * Builds an API-safe message copy without mutating original conversation history.
 */
export class MessageBuilder {
	private indexedMessageCount = 0;
	private indexedTailRef: LlmsProviders.Message | undefined;
	private readonly toolNameByIdCache = new Map<string, string>();
	private readonly readLocatorsByToolUseIdCache = new Map<
		string,
		ReadLocator[]
	>();
	private readonly latestReadToolUseByLocatorCache = new Map<string, string>();
	private readonly latestFullContentOwnerByPathCache = new Map<
		string,
		string
	>();
	private readResultLocatorCache = new WeakMap<object, ReadLocator[]>();

	constructor(
		private readonly maxToolResultChars = DEFAULT_MAX_TOOL_RESULT_CHARS,
		private readonly targetToolNames = TARGET_TOOL_NAMES,
	) {}

	buildForApi(messages: LlmsProviders.Message[]): LlmsProviders.Message[] {
		this.reindex(messages);
		const toolNameById = this.toolNameByIdCache;
		const readLocatorsByToolUseId = this.readLocatorsByToolUseIdCache;
		const latestReadToolUseByLocator = this.latestReadToolUseByLocatorCache;
		const latestFullContentOwnerByPath = this.latestFullContentOwnerByPathCache;

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
						readLocatorsByToolUseId.get(block.tool_use_id),
					);
					if (readRecord) {
						const outdatedLocators = readRecord.locators.filter((locator) =>
							this.isOutdatedReadLocator(
								locator,
								block.tool_use_id,
								latestReadToolUseByLocator,
								latestFullContentOwnerByPath,
							),
						);
						if (outdatedLocators.length > 0) {
							nextContent = this.replaceOutdatedReadContent(
								nextContent,
								outdatedLocators,
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

			for (let j = 0; j < message.content.length; j++) {
				const block = message.content[j];
				if (block.type === "file") {
					this.latestFullContentOwnerByPathCache.set(
						block.path,
						this.toFileBlockOwnerKey(i, j),
					);
					continue;
				}
				if (block.type === "tool_use") {
					const normalizedName = block.name.toLowerCase();
					this.toolNameByIdCache.set(block.id, normalizedName);
					if (this.isReadTool(normalizedName)) {
						const locators = this.extractLocatorsFromReadToolInput(block.input);
						if (locators.length > 0) {
							this.readLocatorsByToolUseIdCache.set(block.id, locators);
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
						this.readLocatorsByToolUseIdCache.get(block.tool_use_id),
					);
					if (!readRecord) {
						continue;
					}
					for (const locator of readRecord.locators) {
						this.latestReadToolUseByLocatorCache.set(
							this.toReadLocatorKey(locator),
							readRecord.toolUseId,
						);
						if (this.isFullFileRead(locator)) {
							this.latestFullContentOwnerByPathCache.set(
								locator.path,
								readRecord.toolUseId,
							);
						}
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
		this.readLocatorsByToolUseIdCache.clear();
		this.latestReadToolUseByLocatorCache.clear();
		this.latestFullContentOwnerByPathCache.clear();
		this.readResultLocatorCache = new WeakMap<object, ReadLocator[]>();
	}

	private getReadResultRecord(
		block: LlmsProviders.ToolResultContent,
		fallbackLocators: ReadLocator[] | undefined,
	): ReadResultRecord | undefined {
		const blockRef = block as unknown as object;
		const cachedParsedLocators = this.readResultLocatorCache.get(blockRef);
		const parsedLocators =
			cachedParsedLocators ??
			this.extractReadLocatorsFromToolResultContent(block.content);
		if (!cachedParsedLocators) {
			this.readResultLocatorCache.set(blockRef, parsedLocators);
		}
		const locators =
			parsedLocators.length > 0 ? parsedLocators : (fallbackLocators ?? []);
		if (locators.length === 0) {
			return undefined;
		}

		return {
			toolUseId: block.tool_use_id,
			locators,
		};
	}

	private extractLocatorsFromReadToolInput(input: unknown): ReadLocator[] {
		if (!input || typeof input !== "object") {
			return [];
		}

		const record = input as Record<string, unknown>;
		const locators: ReadLocator[] = [];
		const directLocator = this.extractLocatorFromReadRequest(record);
		if (directLocator) {
			locators.push(directLocator);
		}

		const maybeFiles = record.files;
		if (Array.isArray(maybeFiles)) {
			for (const value of maybeFiles) {
				const locator = this.extractLocatorFromReadRequest(value);
				if (locator) {
					locators.push(locator);
				}
			}
		}

		const maybeFilePaths = record.file_paths;
		if (Array.isArray(maybeFilePaths)) {
			for (const value of maybeFilePaths) {
				if (typeof value === "string" && value.length > 0) {
					locators.push({
						path: value,
						startLine: null,
						endLine: null,
					});
				}
			}
		}

		return this.dedupeReadLocators(locators);
	}

	private extractReadLocatorsFromToolResultContent(
		content: LlmsProviders.ToolResultContent["content"],
	): ReadLocator[] {
		if (typeof content !== "string") {
			return [];
		}

		try {
			const parsed = JSON.parse(content);
			return this.extractLocatorsFromParsedReadResult(parsed);
		} catch {
			return [];
		}
	}

	private extractLocatorsFromParsedReadResult(value: unknown): ReadLocator[] {
		if (Array.isArray(value)) {
			return this.dedupeReadLocators(
				value
					.map((item) => this.extractLocatorFromResultEntry(item))
					.filter((locator): locator is ReadLocator => locator !== undefined),
			);
		}

		const locator = this.extractLocatorFromResultEntry(value);
		return locator ? [locator] : [];
	}

	private extractLocatorFromReadRequest(
		value: unknown,
	): ReadLocator | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}

		const record = value as Record<string, unknown>;
		const path = this.extractPath(record);
		if (!path) {
			return undefined;
		}

		return {
			path,
			startLine: this.extractLineNumber(record.start_line),
			endLine: this.extractLineNumber(record.end_line),
		};
	}

	private extractLocatorFromResultEntry(
		value: unknown,
	): ReadLocator | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}

		const record = value as Record<string, unknown>;
		const directPath = this.extractPath(record);
		if (directPath) {
			return {
				path: directPath,
				startLine: this.extractLineNumber(record.start_line),
				endLine: this.extractLineNumber(record.end_line),
			};
		}

		if (typeof record.query === "string" && record.query.length > 0) {
			return this.parseReadQuery(record.query);
		}

		return undefined;
	}

	private extractPath(record: Record<string, unknown>): string | undefined {
		const candidates = [record.path, record.file_path, record.filePath];
		for (const candidate of candidates) {
			if (typeof candidate === "string" && candidate.length > 0) {
				return candidate;
			}
		}

		return undefined;
	}

	private extractLineNumber(value: unknown): number | null {
		return typeof value === "number" && Number.isInteger(value) ? value : null;
	}

	private parseReadQuery(query: string): ReadLocator {
		const match = /^(.*):(\d+)-(EOF|\d+)$/.exec(query);
		if (!match) {
			return { path: query, startLine: null, endLine: null };
		}

		return {
			path: match[1],
			startLine: Number(match[2]),
			endLine: match[3] === "EOF" ? null : Number(match[3]),
		};
	}

	private dedupeReadLocators(locators: ReadLocator[]): ReadLocator[] {
		const unique = new Map<string, ReadLocator>();
		for (const locator of locators) {
			unique.set(this.toReadLocatorKey(locator), locator);
		}
		return Array.from(unique.values());
	}

	private toReadLocatorKey(locator: ReadLocator): string {
		if (this.isFullFileRead(locator)) {
			return locator.path;
		}
		return `${locator.path}:${locator.startLine ?? 1}-${locator.endLine ?? "EOF"}`;
	}

	private isFullFileRead(locator: ReadLocator): boolean {
		return locator.startLine == null && locator.endLine == null;
	}

	private isOutdatedReadLocator(
		locator: ReadLocator,
		toolUseId: string,
		latestReadToolUseByLocator: Map<string, string>,
		latestFullContentOwnerByPath: Map<string, string>,
	): boolean {
		const latestFullContentOwner = latestFullContentOwnerByPath.get(
			locator.path,
		);
		if (latestFullContentOwner && latestFullContentOwner !== toolUseId) {
			return true;
		}

		return (
			latestReadToolUseByLocator.get(this.toReadLocatorKey(locator)) !==
			toolUseId
		);
	}

	private toFileBlockOwnerKey(
		messageIndex: number,
		blockIndex: number,
	): string {
		return `file:${messageIndex}:${blockIndex}`;
	}

	private replaceOutdatedReadContent(
		content: LlmsProviders.ToolResultContent["content"],
		outdatedLocators: ReadLocator[],
	): LlmsProviders.ToolResultContent["content"] {
		const outdatedLocatorKeySet = new Set(
			outdatedLocators.map((locator) => this.toReadLocatorKey(locator)),
		);
		const outdatedPathSet = new Set(
			outdatedLocators.map((locator) => locator.path),
		);

		if (typeof content === "string") {
			const replaced = this.replaceOutdatedReadContentInString(
				content,
				outdatedLocatorKeySet,
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
				outdatedLocatorKeySet,
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
		outdatedLocatorKeySet: Set<string>,
	): string | null {
		try {
			const parsed = JSON.parse(text);
			const replaced = this.replaceOutdatedReadContentInParsed(
				parsed,
				outdatedLocatorKeySet,
			);
			return JSON.stringify(replaced);
		} catch {
			return null;
		}
	}

	private replaceOutdatedReadContentInParsed(
		value: unknown,
		outdatedLocatorKeySet: Set<string>,
	): unknown {
		if (Array.isArray(value)) {
			return value.map((entry) =>
				this.replaceOutdatedReadEntry(entry, outdatedLocatorKeySet),
			);
		}

		return this.replaceOutdatedReadEntry(value, outdatedLocatorKeySet);
	}

	private replaceOutdatedReadEntry(
		entry: unknown,
		outdatedLocatorKeySet: Set<string>,
	): unknown {
		if (!entry || typeof entry !== "object") {
			return entry;
		}

		const record = { ...(entry as Record<string, unknown>) };
		const locator = this.extractLocatorFromResultEntry(record);
		if (!locator) {
			return entry;
		}
		const locatorKey = this.toReadLocatorKey(locator);
		if (!outdatedLocatorKeySet.has(locatorKey)) {
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

		const marker = `\n\n...[truncated ${Math.max(0, text.length - this.maxToolResultChars)} chars]...\n\n`;
		const availableChars = Math.max(0, this.maxToolResultChars - marker.length);
		const keepCharsPerSide = Math.floor(availableChars / 2);
		const retainedChars = keepCharsPerSide * 2;
		const removedChars = Math.max(0, text.length - retainedChars);
		const effectiveMarker = `\n\n...[truncated ${removedChars} chars]...\n\n`;
		const effectiveAvailableChars = Math.max(
			0,
			this.maxToolResultChars - effectiveMarker.length,
		);
		const effectiveKeepCharsPerSide = Math.floor(effectiveAvailableChars / 2);

		const start = text.slice(0, effectiveKeepCharsPerSide);
		const end = text.slice(-effectiveKeepCharsPerSide);

		return `${start}${effectiveMarker}${end}`;
	}
}
