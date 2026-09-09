import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { sharedSessionArtifactPath } from "../paths";

export type MistakeToolResult = {
	messageId: string;
	toolCallId: string;
	toolName: string;
	output: unknown;
	isError: boolean;
};

function resultPath(sessionId: string): string {
	return sharedSessionArtifactPath(sessionId, "desktop-mistake-tools.jsonl");
}

// A stop control in afterTool exits before the SDK persists the current
// batch's results. Keep the actual completed results for desktop display,
// without changing the SDK transcript or guessing from session status.
export function preserveMistakeToolResults(
	sessionId: string,
	results: MistakeToolResult[],
): void {
	if (results.length === 0) return;
	const path = resultPath(sessionId);
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(
		path,
		`${results.map((result) => JSON.stringify(result)).join("\n")}\n`,
	);
}

export function readMistakeToolResults(sessionId: string): MistakeToolResult[] {
	const path = resultPath(sessionId);
	if (!existsSync(path)) return [];
	try {
		return readFileSync(path, "utf8")
			.split("\n")
			.flatMap((line) => {
				try {
					const result = JSON.parse(line) as MistakeToolResult;
					return result &&
						typeof result.messageId === "string" &&
						typeof result.toolCallId === "string" &&
						typeof result.toolName === "string" &&
						typeof result.isError === "boolean"
						? [result]
						: [];
				} catch {
					return [];
				}
			});
	} catch {
		return [];
	}
}
