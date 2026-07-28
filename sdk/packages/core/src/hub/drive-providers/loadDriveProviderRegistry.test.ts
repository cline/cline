import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_WEB_SPEECH_STT_ID } from "@cline/shared";
import { loadDriveProviderRegistry } from "./loadDriveProviderRegistry";

describe("loadDriveProviderRegistry", () => {
	it("always includes builtins", () => {
		const registry = loadDriveProviderRegistry({});
		expect(registry.some((entry) => entry.id === BUILTIN_WEB_SPEECH_STT_ID)).toBe(
			true,
		);
	});

	it("loads a workspace provider manifest", () => {
		const root = mkdtempSync(join(tmpdir(), "drive-providers-"));
		const providerDir = join(root, ".cline", "drive", "providers", "my-stt");
		mkdirSync(providerDir, { recursive: true });
		writeFileSync(
			join(providerDir, "manifest.json"),
			JSON.stringify({
				schemaVersion: 1,
				id: "workspace.my-stt",
				slot: "stt",
				title: "My STT",
				origin: "workspace",
				egress: "loopback-only",
				backend: { kind: "local-worker", engine: "custom" },
				defaultConfig: {},
				configSchemaId: "workspace.my-stt.v1",
			}),
		);

		const registry = loadDriveProviderRegistry({ workspaceRoot: root });
		expect(registry.some((entry) => entry.id === "workspace.my-stt")).toBe(
			true,
		);
	});

	it("skips manifests with secrets", () => {
		const root = mkdtempSync(join(tmpdir(), "drive-providers-bad-"));
		const providerDir = join(root, ".cline", "drive", "providers", "bad");
		mkdirSync(providerDir, { recursive: true });
		writeFileSync(
			join(providerDir, "manifest.json"),
			JSON.stringify({
				schemaVersion: 1,
				id: "workspace.bad",
				slot: "stt",
				title: "Bad",
				origin: "workspace",
				egress: "loopback-only",
				backend: { kind: "local-worker", engine: "x" },
				defaultConfig: { apiKey: "secret" },
				configSchemaId: "workspace.bad.v1",
			}),
		);

		const registry = loadDriveProviderRegistry({ workspaceRoot: root });
		expect(registry.some((entry) => entry.id === "workspace.bad")).toBe(
			false,
		);
	});
});
