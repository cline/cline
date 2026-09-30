import { randomUUID } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Message, ToolResultContent } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import {
	formatToolResultRecoveryNotice,
	isToolResultRecoveryNotice,
	serializeToolResultContent,
} from "./tool-result-recovery";

const RECORD_SUFFIX = ".record.json";

interface ToolResultRecord {
	toolCallId: string;
	path: string;
}

/**
 * Durable recovery files referenced by recorded session messages.
 *
 * Each successful save also writes a core-owned record mapping the tool-call
 * ID to the saved path. Only recorded pairs identify a recovery notice, so
 * tool output cannot grant itself notice status by embedding metadata.
 */
export class ToolResultStore {
	private directoryPromise?: Promise<string>;
	private recordsPromise?: Promise<void>;
	private readonly records = new Set<string>();

	private readonly root: string;
	constructor(root = join(resolveClineDataDir(), "tool-results")) {
		// Capture the base before lazy writes or a later working-directory change.
		this.root = resolve(root);
	}

	/** True only when this store saved `path` for `toolCallId`. Call `loadRecords` first. */
	isRecorded(toolCallId: string, path: string): boolean {
		return this.records.has(recordKey(toolCallId, path));
	}

	/** Load records persisted by earlier runtimes that shared this root (resume). */
	loadRecords(): Promise<void> {
		this.recordsPromise ??= this.readPersistedRecords();
		return this.recordsPromise;
	}

	async save(result: ToolResultContent): Promise<string> {
		// Lazy allocation keeps storage failures out of session startup. Each
		// runtime gets its own namespace, including delegated agents and resumes.
		this.directoryPromise ??= mkdir(this.root, { recursive: true, mode: 0o700 })
			.then(() => mkdtemp(join(this.root, "results-")))
			.catch((error) => {
				this.directoryPromise = undefined;
				throw error;
			});
		const directory = await this.directoryPromise;
		const encodedId = encodeURIComponent(result.tool_use_id);
		const path = join(directory, `${encodedId}.result.txt`);
		const text = serializeToolResultContent(result.content);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await writeAtomic(directory, path, text);
		// Record only after the result is durably in place.
		const record: ToolResultRecord = { toolCallId: result.tool_use_id, path };
		await writeAtomic(
			directory,
			join(directory, `${encodedId}${RECORD_SUFFIX}`),
			JSON.stringify(record),
		);
		this.records.add(recordKey(record.toolCallId, record.path));
		return path;
	}

	/** Give seeded sessions their own recovery files before the source can be deleted. */
	async copyReferences<T extends Message>(
		messages: T[],
		sessionsDirectory: string,
	): Promise<T[]> {
		const allowedRoot = resolve(sessionsDirectory);
		const sources = new Map<string, ToolResultStore>();
		const copies = new Map<string, Promise<string>>();
		return Promise.all(
			messages.map(async (message) => {
				if (!Array.isArray(message.content)) return message;
				const content = await Promise.all(
					message.content.map(async (block) => {
						if (block.type !== "tool_result" || !Array.isArray(block.content))
							return block;
						const entries = [];
						for (const entry of block.content) {
							if (
								entry.type !== "text" ||
								typeof entry.toolResultFile !== "string"
							) {
								entries.push(entry);
								continue;
							}
							const oldPath = resolve(entry.toolResultFile);
							const sourceRoot = dirname(dirname(oldPath));
							if (
								!oldPath.startsWith(`${allowedRoot}${sep}`) ||
								sourceRoot === this.root
							) {
								entries.push(entry);
								continue;
							}
							let source = sources.get(sourceRoot);
							if (!source) {
								source = new ToolResultStore(sourceRoot);
								sources.set(sourceRoot, source);
							}
							await source.loadRecords();
							if (
								!isToolResultRecoveryNotice(
									entry,
									block.tool_use_id,
									(id, path) => source.isRecorded(id, path),
								)
							) {
								entries.push(entry);
								continue;
							}
							const key = recordKey(block.tool_use_id, oldPath);
							let copy = copies.get(key);
							if (!copy) {
								// A fresh namespace also isolates duplicate call IDs in imported history.
								copy = readFile(oldPath, "utf8").then((content) =>
									new ToolResultStore(this.root).save({ ...block, content }),
								);
								copies.set(key, copy);
							}
							let path: string;
							try {
								path = await copy;
							} catch {
								// Recovery is best-effort. Keep the preview and other
								// content, but omit a notice we could not copy.
								continue;
							}
							entries.push({
								...entry,
								text: formatToolResultRecoveryNotice(path),
								toolResultFile: path,
							});
						}
						return { ...block, content: entries };
					}),
				);
				return { ...message, content };
			}),
		);
	}

	private async readPersistedRecords(): Promise<void> {
		let directories: string[];
		try {
			directories = await readdir(this.root);
		} catch {
			return;
		}
		await Promise.all(
			directories
				.filter((name) => name.startsWith("results-"))
				.map(async (name) => {
					const directory = join(this.root, name);
					let files: string[];
					try {
						files = await readdir(directory);
					} catch {
						return;
					}
					await Promise.all(
						files
							.filter((file) => file.endsWith(RECORD_SUFFIX))
							.map(async (file) => {
								try {
									const record = JSON.parse(
										await readFile(join(directory, file), "utf8"),
									) as Partial<ToolResultRecord>;
									if (
										typeof record.toolCallId === "string" &&
										typeof record.path === "string" &&
										resolve(record.path).startsWith(`${directory}${sep}`)
									) {
										this.records.add(recordKey(record.toolCallId, record.path));
									}
								} catch {
									// Unreadable records simply leave notices unprotected.
								}
							}),
					);
				}),
		);
	}
}

function recordKey(toolCallId: string, path: string): string {
	return `${toolCallId}\0${path}`;
}

async function writeAtomic(
	directory: string,
	path: string,
	text: string,
): Promise<void> {
	const temporaryPath = join(directory, `${randomUUID()}.tmp`);
	try {
		await writeFile(temporaryPath, text, {
			encoding: "utf8",
			mode: 0o600,
			flag: "wx",
		});
		await rename(temporaryPath, path);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}
