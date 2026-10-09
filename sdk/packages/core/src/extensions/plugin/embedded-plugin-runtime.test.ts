import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { materializePluginRuntime } from "./embedded-plugin-runtime";

it("isolates resource builds and repairs files with atomic writes", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-embedded-plugins-"));
	const pack = (content: string) => {
		const json = JSON.stringify({
			"plugin-sandbox-bootstrap.js": content,
			"node_modules/sdk/index.cjs": "exports.createTool = () => {}",
		});
		return {
			hash: createHash("sha256").update(json).digest("hex"),
			payload: gzipSync(json).toString("base64"),
		};
	};
	try {
		const first = pack("first build");
		const path = materializePluginRuntime(first, root);
		const other = materializePluginRuntime(pack("other build"), root);
		expect(other).not.toBe(path);
		writeFileSync(path, "corrupted");
		expect(materializePluginRuntime(first, root)).toBe(path);
		expect(readFileSync(path, "utf8")).toBe("first build");
		expect(readFileSync(other, "utf8")).toBe("other build");
		expect(() =>
			materializePluginRuntime({ ...first, hash: "0".repeat(64) }, root),
		).toThrow("Invalid embedded");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
