import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolResultContent } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import { serializeToolResultContent } from "./tool-result-recovery";

/** Durable recovery files referenced by recorded session messages. */
export class ToolResultStore {
	private directoryPromise?: Promise<string>;

	constructor(
		private readonly root = join(resolveClineDataDir(), "tool-results"),
	) {}

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
		const filename = `${encodeURIComponent(result.tool_use_id)}.result.txt`;
		const path = join(directory, filename);
		const temporaryPath = join(directory, `${randomUUID()}.tmp`);
		const text = serializeToolResultContent(result.content);
		await mkdir(directory, { recursive: true, mode: 0o700 });
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
		return path;
	}
}
