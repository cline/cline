import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolResultContent } from "@cline/shared";
import { resolveSessionDataDir } from "@cline/shared/storage";
import { SessionArtifacts } from "../../services/session-artifacts";
import { serializeToolResultContent } from "./tool-result-recovery";

/** Complete external tool output, owned by the same directory as session history. */
export class ToolResultStore {
	private readonly artifacts: SessionArtifacts;

	constructor(
		private readonly sessionId: string,
		sessionsDirectory = resolveSessionDataDir(),
	) {
		this.artifacts = new SessionArtifacts(() => sessionsDirectory);
	}

	async save(result: ToolResultContent): Promise<string> {
		// Resolve lazily: a storage failure must not prevent session startup.
		const directory = this.artifacts.sessionToolResultsDir(this.sessionId);
		// Encode provider-owned IDs reversibly: separators must not escape tools/,
		// and different IDs must not collapse to the same sanitized filename.
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
