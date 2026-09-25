import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ToolResultContent } from "@cline/shared";
import { resolveSessionDataDir } from "@cline/shared/storage";

/** Complete external tool output, owned by the same directory as session history. */
export class ToolResultStore {
	private readonly directory: string;

	constructor(sessionId: string, sessionsDirectory = resolveSessionDataDir()) {
		if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(sessionId)) {
			throw new Error("Invalid session ID for tool result storage");
		}
		this.directory = resolve(sessionsDirectory, sessionId, "tools");
	}

	async save(result: ToolResultContent): Promise<string> {
		// Encode provider-owned IDs reversibly: separators must not escape tools/,
		// and different IDs must not collapse to the same sanitized filename.
		const filename = `${encodeURIComponent(result.tool_use_id)}.result.txt`;
		const path = join(this.directory, filename);
		const temporaryPath = join(this.directory, `${randomUUID()}.tmp`);
		const text =
			typeof result.content === "string"
				? result.content
				: JSON.stringify(result.content, null, 2);
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
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
