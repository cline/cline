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

	it("preserves binary payloads for non-text blocks in mixed MCP content", () => {
		const raw = {
			content: [
				{ type: "text", text: "before" },
				{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
				{
					type: "resource",
					resource: { uri: "file:///a.bin", blob: "d29ybGQ=" },
				},
				{ type: "resource_link", uri: "file:///b.md", name: "b.md" },
				{ type: "text", text: "after" },
			],
		};
		expect(extractFullOutputText(raw)).toBe(
			[
				"before",
				"[image image/png, 5 B base64]",
				"aGVsbG8=",
				"[resource file:///a.bin, 5 B base64]",
				"d29ybGQ=",
				"[resource_link: file:///b.md]",
				"after",
			].join("\n"),
		);
	});

	it("chunks large base64 payloads into fixed-width lines behind a header", () => {
		const data = "A".repeat(76 * 2 + 10);
		const raw = {
			content: [{ type: "image", data, mimeType: "image/jpeg" }],
		};
		const result = extractFullOutputText(raw);
		const lines = result?.split("\n") ?? [];

		expect(lines[0]).toBe("[image image/jpeg, 121 B base64]");
		expect(lines).toHaveLength(4);
		expect(lines[1]).toHaveLength(76);
		expect(lines[2]).toHaveLength(76);
		expect(lines[3]).toHaveLength(10);
		expect(lines.slice(1).join("")).toBe(data);
	});

	it("keeps a metadata-only placeholder for image blocks without data", () => {
		const raw = {
			content: [{ type: "image", mimeType: "image/png" }],
		};
		expect(extractFullOutputText(raw)).toBe("[image: image/png]");
	});

	it("includes the mime type in blob-backed resource headers when present", () => {
		const raw = {
			content: [
				{
					type: "resource",
					resource: {
						uri: "file:///a.pdf",
						mimeType: "application/pdf",
						blob: "aGVsbG8=",
					},
				},
			],
		};
		expect(extractFullOutputText(raw)).toBe(
			"[resource file:///a.pdf application/pdf, 5 B base64]\naGVsbG8=",
		);
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
