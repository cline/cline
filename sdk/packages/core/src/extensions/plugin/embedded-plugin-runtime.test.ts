import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { registerEmbeddedPluginRuntime } from "@cline/shared";
import { setClineDir } from "@cline/shared/storage";
import { expect, it } from "vitest";
import {
	materializePluginRuntime,
	resolveEmbeddedPluginBootstrap,
} from "./embedded-plugin-runtime";

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

it("resolves through the registry and re-extracts a cleared runtime directory", () => {
	const clineDir = mkdtempSync(join(tmpdir(), "cline-embedded-registry-"));
	const previousClineDir = process.env.CLINE_DIR;
	setClineDir(clineDir);
	try {
		// Nothing registered, or a thunk that throws (no build-time define).
		registerEmbeddedPluginRuntime(() => {
			throw new ReferenceError("CLINE_PLUGIN_RUNTIME_RESOURCES is not defined");
		});
		expect(resolveEmbeddedPluginBootstrap()).toBeUndefined();

		const resources = pack("registered build");
		registerEmbeddedPluginRuntime(() => resources);
		const path = resolveEmbeddedPluginBootstrap();
		expect(path).toBe(
			join(
				clineDir,
				"runtime",
				"plugin-sandbox",
				resources.hash,
				"plugin-sandbox-bootstrap.js",
			),
		);
		expect(readFileSync(path ?? "", "utf8")).toBe("registered build");

		rmSync(join(clineDir, "runtime"), { recursive: true, force: true });
		expect(resolveEmbeddedPluginBootstrap()).toBe(path);
		expect(readFileSync(path ?? "", "utf8")).toBe("registered build");
	} finally {
		registerEmbeddedPluginRuntime(() => {
			throw new ReferenceError("unregistered");
		});
		if (previousClineDir) setClineDir(previousClineDir);
		rmSync(clineDir, { recursive: true, force: true });
	}
});
