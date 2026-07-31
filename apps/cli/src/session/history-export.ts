import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateConversationHTML } from "./export";
import { readSessionMessagesArtifact } from "./session";

export type HistoryExportFormat = "html" | "json";

export async function exportHistorySession(input: {
	sessionId: string;
	format: HistoryExportFormat;
	outputPath?: string;
	outputDirectory?: string;
}): Promise<string> {
	const { sessionId, format, outputPath, outputDirectory } = input;
	const data = await readSessionMessagesArtifact(sessionId);
	if (!data) {
		throw new Error(`Session ${sessionId} not found or has no messages.json`);
	}

	const targetPath = outputPath?.trim()
		? resolve(outputPath)
		: resolve(
				outputDirectory?.trim() || process.cwd(),
				`${sessionId}.${format}`,
			);
	const contents =
		format === "html"
			? generateConversationHTML(data, sessionId)
			: `${JSON.stringify(data, null, 2)}\n`;

	await mkdir(dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, "utf8");
	return targetPath;
}
