import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { materializePluginRuntime } from "./embedded-plugin-runtime";

function pack(content: string) {
	const json = JSON.stringify({
		"plugin-sandbox-bootstrap.js": content,
		"node_modules/@cline/core/index.cjs": "exports.createTool = () => {}",
	});
	return {
		hash: createHash("sha256").update(json).digest("hex"),
		payload: gzipSync(json).toString("base64"),
	};
}

it("isolates builds by content hash and repairs tampered files", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-embedded-plugins-"));
	try {
		const first = pack("first build");
		const path = materializePluginRuntime(first, root);
		expect(path).toBe(join(root, first.hash, "plugin-sandbox-bootstrap.js"));
		expect(
			readFileSync(
				join(root, first.hash, "node_modules/@cline/core/index.cjs"),
				"utf8",
			),
		).toContain("createTool");

		const other = materializePluginRuntime(pack("other build"), root);
		expect(other).not.toBe(path);

		writeFileSync(path, "corrupted");
		expect(materializePluginRuntime(first, root)).toBe(path);
		expect(readFileSync(path, "utf8")).toBe("first build");
		expect(readFileSync(other, "utf8")).toBe("other build");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("rejects payloads whose hash does not match", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-embedded-plugins-"));
	try {
		expect(() =>
			materializePluginRuntime({ ...pack("x"), hash: "0".repeat(64) }, root),
		).toThrow("Invalid embedded plugin runtime");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
