import { describe, expect, it } from "vitest";
import {
	assertNoSecretProviderConfigKeys,
	BUILTIN_PROVIDER_MANIFESTS,
	BUILTIN_WEB_SPEECH_STT_ID,
	parseDriveProviderManifest,
} from "./providers";

describe("parseDriveProviderManifest", () => {
	it("parses builtin web speech", () => {
		const manifest = BUILTIN_PROVIDER_MANIFESTS.find(
			(entry) => entry.id === BUILTIN_WEB_SPEECH_STT_ID,
		);
		expect(manifest?.slot).toBe("stt");
		expect(manifest?.egress).toBe("platform-cloud");
	});

	it("rejects secret keys in defaultConfig", () => {
		expect(() =>
			parseDriveProviderManifest({
				schemaVersion: 1,
				id: "workspace.bad",
				slot: "stt",
				title: "Bad",
				origin: "workspace",
				egress: "loopback-only",
				backend: { kind: "local-worker", engine: "x" },
				defaultConfig: { apiKey: "sk-test" },
				configSchemaId: "workspace.bad.v1",
			}),
		).toThrow(/apiKey/);
	});

	it("rejects tts backend on stt slot", () => {
		expect(() =>
			parseDriveProviderManifest({
				schemaVersion: 1,
				id: "workspace.mismatch",
				slot: "stt",
				title: "Mismatch",
				origin: "workspace",
				egress: "loopback-only",
				backend: { kind: "browser-speechSynthesis" },
				defaultConfig: {},
				configSchemaId: "workspace.mismatch.v1",
			}),
		).toThrow();
	});
});

describe("assertNoSecretProviderConfigKeys", () => {
	it("allows empty config", () => {
		expect(() => assertNoSecretProviderConfigKeys({})).not.toThrow();
	});

	it("rejects token", () => {
		expect(() =>
			assertNoSecretProviderConfigKeys({ token: "x" }),
		).toThrow(/token/);
	});
});
