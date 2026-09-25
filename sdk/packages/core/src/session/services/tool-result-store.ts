import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResultContent } from "@cline/shared";
import { serializeToolResultContent } from "./tool-result-recovery";

/** Disposable recovery files, isolated per runtime rather than session history. */
export class ToolResultStore {
	private directoryPromise?: Promise<string>;

	constructor(private readonly temporaryRoot = tmpdir()) {}

	async save(result: ToolResultContent): Promise<string> {
		// Lazy allocation keeps storage failures out of session startup. Each
		// runtime gets its own namespace, including delegated agents and resumes.
		this.directoryPromise ??= mkdtemp(
			join(this.temporaryRoot, "cline-tool-results-"),
		).catch((error) => {
			this.directoryPromise = undefined;
			throw error;
		});
		const directory = await this.directoryPromise;
		const filename = `${encodeURIComponent(result.tool_use_id)}.result.txt`;
		const path = join(directory, filename);
		const temporaryPath = join(directory, `${randomUUID()}.tmp`);
		const text = serializeToolResultContent(result.content);
		// Temp cleanup may remove this directory during a live session. Restore
		// it and the complete result before exposing its path to the model again.
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
