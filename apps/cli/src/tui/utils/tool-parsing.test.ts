import { describe, expect, it } from "vitest";
import {
	buildReadFilesKeys,
	extractFullOutputText,
	parseReadFilesInput,
} from "./tool-parsing";

describe("buildReadFilesKeys", () => {
	it("produces unique keys when the same path is read twice", () => {
		const info = parseReadFilesInput({
			files: [{ path: "/a/SKILL.md" }, { path: "/a/SKILL.md" }],
		});
		const keys = buildReadFilesKeys(info?.files ?? []);

		expect(keys).toHaveLength(2);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("produces unique keys for duplicate paths from the file_paths shape", () => {
		const info = parseReadFilesInput({
			file_paths: ["/a/SKILL.md", "/a/SKILL.md", "/b/SKILL.md"],
		});
		const keys = buildReadFilesKeys(info?.files ?? []);

		expect(keys).toHaveLength(3);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("keeps distinct paths in unique keys", () => {
		const keys = buildReadFilesKeys([{ path: "/a.ts" }, { path: "/b.ts" }]);

		expect(new Set(keys).size).toBe(2);
	});

	it("returns no keys for an empty list", () => {
		expect(buildReadFilesKeys([])).toEqual([]);
	});
});

describe("extractFullOutputText", () => {
	it("extracts text with real newlines from the MCP CallToolResult shape", () => {
		const raw = {
			content: [
				{ type: "text", text: "# Memory\n\nline one" },
				{ type: "text", text: "line two" },
			],
		};
		expect(extractFullOutputText(raw)).toBe("# Memory\n\nline one\nline two");
	});

	it("keeps binary payloads behind placeholders in mixed MCP content", () => {
		const raw = {
			content: [
				{ type: "text", text: "before" },
				{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
				{
					type: "resource",
					resource: { uri: "file:///a.md", blob: "d29ybGQ=" },
				},
				{ type: "resource_link", uri: "file:///b.md", name: "b.md" },
				{ type: "text", text: "after" },
			],
		};
		expect(extractFullOutputText(raw)).toBe(
			"before\n[image: image/png]\naGVsbG8=\n[resource: file:///a.md]\nd29ybGQ=\n[resource_link: file:///b.md]\nafter",
		);
	});

	it("chunks base64 payloads into 76-char lines so collapse stays compact", () => {
		const raw = {
			content: [
				{ type: "image", data: "A".repeat(160), mimeType: "image/png" },
			],
		};
		expect(extractFullOutputText(raw)?.split("\n")).toEqual([
			"[image: image/png]",
			"A".repeat(76),
			"A".repeat(76),
			"A".repeat(8),
		]);
	});

	it("extracts embedded resource text from MCP content", () => {
		const raw = {
			content: [
				{
					type: "resource",
					resource: { uri: "file:///memory.md", text: "resource body\nline 2" },
				},
			],
		};
		expect(extractFullOutputText(raw)).toBe("resource body\nline 2");
	});

	it("falls back to pretty JSON for objects without text content", () => {
		const raw = { structuredContent: { ok: true } };
		expect(extractFullOutputText(raw)).toBe(JSON.stringify(raw, null, 2));
	});
});

describe("extractFullOutputText terminal control characters", () => {
	it("collapses carriage-return progress updates to the last state of the line", () => {
		// git/npm/cargo rewrite progress with bare CRs. A terminal returns the
		// cursor to column 0 and overwrites, so what remains visible is the text
		// after the final CR — the earlier states must not reach the renderer.
		const raw =
			"Receiving objects: 78%\rReceiving objects: 79%\rReceiving objects: 100%\ndone";
		expect(extractFullOutputText(raw)).toBe("Receiving objects: 100%\ndone");
	});

	it("drops escape sequences the terminal would execute instead of print", () => {
		const raw =
			"\u001b[31mred\u001b[0m, \u001b]0;window title\u0007bell, \u0008backspace";
		expect(extractFullOutputText(raw)).toBe("red, bell, backspace");
	});

	it("keeps newlines and tabs so real layout survives", () => {
		expect(extractFullOutputText("a\tb\nc\n\td")).toBe("a\tb\nc\n\td");
	});

	it("leaves ordinary text byte-identical", () => {
		const raw = "plain text\n  indented\n";
		expect(extractFullOutputText(raw)).toBe(raw);
	});
});
