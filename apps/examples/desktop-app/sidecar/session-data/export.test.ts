import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SidecarContext } from "../types";
import { exportChatSessionToFile, generateSessionExportHtml } from "./export";

const SESSION_ID = "session-export-test";

let sessionDataDir: string;
let outputDir: string;
let previousSessionDataDir: string | undefined;

function makeCtx(
	liveMessages?: unknown[],
): Pick<SidecarContext, "liveSessions"> {
	const liveSessions = new Map<string, { messages: unknown[] }>();
	if (liveMessages) {
		liveSessions.set(SESSION_ID, { messages: liveMessages });
	}
	return { liveSessions } as unknown as Pick<SidecarContext, "liveSessions">;
}

function persistMessages(messages: unknown[]) {
	const dir = join(sessionDataDir, SESSION_ID);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, `${SESSION_ID}.messages.json`),
		JSON.stringify({ messages }),
	);
}

function persistManifest(manifest: Record<string, unknown>) {
	const dir = join(sessionDataDir, SESSION_ID);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${SESSION_ID}.json`), JSON.stringify(manifest));
}

beforeEach(() => {
	sessionDataDir = mkdtempSync(join(tmpdir(), "cline-export-data-"));
	outputDir = mkdtempSync(join(tmpdir(), "cline-export-out-"));
	previousSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;
	process.env.CLINE_SESSION_DATA_DIR = sessionDataDir;
});

afterEach(() => {
	if (previousSessionDataDir === undefined) {
		delete process.env.CLINE_SESSION_DATA_DIR;
	} else {
		process.env.CLINE_SESSION_DATA_DIR = previousSessionDataDir;
	}
	rmSync(sessionDataDir, { recursive: true, force: true });
	rmSync(outputDir, { recursive: true, force: true });
});

describe("generateSessionExportHtml", () => {
	it("renders a standalone document with messages, tools, and stats", () => {
		const html = generateSessionExportHtml({
			sessionId: SESSION_ID,
			title: "Fix the <login> bug",
			updatedAt: "2026-08-06T12:00:00.000Z",
			messages: [
				{ role: "user", content: "Please fix the bug & ship it" },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "secret reasoning" },
						{ type: "text", text: "On it. Running the tests:" },
						{
							type: "tool_use",
							id: "tool-1",
							name: "run_command",
							input: { command: "bun test" },
						},
					],
					metrics: { inputTokens: 120, outputTokens: 30, cost: 0.0123 },
					modelInfo: { id: "test-model", provider: "cline" },
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "42 tests passed",
							is_error: false,
						},
					],
				},
			],
		});

		expect(html).toContain("<!DOCTYPE html>");
		// Titles and user text are escaped.
		expect(html).toContain("Fix the &lt;login&gt; bug");
		expect(html).toContain("Please fix the bug &amp; ship it");
		// Tool call renders with its paired result.
		expect(html).toContain("run_command");
		expect(html).toContain("bun test");
		expect(html).toContain("42 tests passed");
		expect(html).toContain("Success");
		// Internal reasoning stays out of the shared export.
		expect(html).not.toContain("secret reasoning");
		// Header stats: 2 visible messages (tool_result-only user turn hidden).
		expect(html).toContain("2 messages");
		expect(html).toContain("150 tokens");
		expect(html).toContain("$0.0123");
		expect(html).toContain("test-model");
	});

	it("hides users' empty turns but keeps assistant messages", () => {
		const html = generateSessionExportHtml({
			sessionId: SESSION_ID,
			messages: [
				{ role: "user", content: "   " },
				{ role: "assistant", content: "Done." },
				{ role: "system", content: "internal prompt" },
			],
		});
		expect(html).toContain("1 messages");
		expect(html).toContain("Done.");
		expect(html).not.toContain("internal prompt");
	});
});

describe("exportChatSessionToFile", () => {
	it("writes a standalone HTML file from the persisted transcript", () => {
		persistMessages([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		]);
		persistManifest({
			metadata: { title: "Greeting session" },
			updatedAt: "2026-08-06T12:00:00.000Z",
		});

		const result = exportChatSessionToFile(makeCtx(), {
			sessionId: SESSION_ID,
			format: "html",
			outputDirectory: outputDir,
		});

		expect(result.messageCount).toBe(2);
		expect(result.format).toBe("html");
		expect(result.path.startsWith(outputDir)).toBe(true);
		expect(result.path.endsWith(".html")).toBe(true);
		const contents = readFileSync(result.path, "utf8");
		expect(contents).toContain("Greeting session");
		expect(contents).toContain("hello");
		expect(contents).toContain("hi there");
		expect(readdirSync(outputDir)).toHaveLength(1);
	});

	it("exports JSON when requested", () => {
		persistMessages([{ role: "user", content: "hello" }]);

		const result = exportChatSessionToFile(makeCtx(), {
			sessionId: SESSION_ID,
			format: "json",
			outputDirectory: outputDir,
		});

		expect(result.path.endsWith(".json")).toBe(true);
		const parsed = JSON.parse(readFileSync(result.path, "utf8"));
		expect(parsed.sessionId).toBe(SESSION_ID);
		expect(parsed.messages).toEqual([{ role: "user", content: "hello" }]);
	});

	it("falls back to the live in-memory transcript before first persistence", () => {
		const ctx = makeCtx([
			{ role: "user", content: "streaming question" },
			{ role: "assistant", content: "streaming answer" },
		]);

		const result = exportChatSessionToFile(ctx, {
			sessionId: SESSION_ID,
			format: "html",
			outputDirectory: outputDir,
		});

		const contents = readFileSync(result.path, "utf8");
		expect(contents).toContain("streaming question");
		expect(contents).toContain("streaming answer");
	});

	it("rejects sessions without any messages", () => {
		expect(() =>
			exportChatSessionToFile(makeCtx(), {
				sessionId: SESSION_ID,
				format: "html",
				outputDirectory: outputDir,
			}),
		).toThrow(/no messages/);
		expect(() =>
			exportChatSessionToFile(makeCtx(), {
				sessionId: "   ",
				format: "html",
				outputDirectory: outputDir,
			}),
		).toThrow(/sessionId/);
	});
});
