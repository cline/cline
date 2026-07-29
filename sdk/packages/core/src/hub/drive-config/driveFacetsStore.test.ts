import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultFacetValuesFromProfile } from "@cline/drive";
import { BUILTIN_WEB_SPEECH_STT_ID } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { loadOrSeedDriveFacets, setDriveFacets } from "./driveFacetsStore";

describe("driveFacetsStore", () => {
	it("seeds cloud defaults when missing", () => {
		const root = mkdtempSync(join(tmpdir(), "drive-facets-"));
		const facets = loadOrSeedDriveFacets({ configParent: root });
		expect(facets["runtime.profile"]).toBe("cloud");
		expect(facets["providers.sttId"]).toBe(BUILTIN_WEB_SPEECH_STT_ID);
	});

	it("rejects illegal local + webSpeech write", () => {
		const root = mkdtempSync(join(tmpdir(), "drive-facets-bad-"));
		const facets = defaultFacetValuesFromProfile("local");
		const result = setDriveFacets({
			configParent: root,
			facets: {
				...facets,
				"providers.sttId": BUILTIN_WEB_SPEECH_STT_ID,
			},
			llm: {
				kind: "local",
				providerId: "ollama",
				baseUrlClass: "loopback",
			},
		});
		expect(result.ok).toBe(false);
	});

	it("persists a legal cloud selection", () => {
		const root = mkdtempSync(join(tmpdir(), "drive-facets-ok-"));
		const facets = defaultFacetValuesFromProfile("cloud");
		const result = setDriveFacets({
			configParent: root,
			facets,
			llm: { kind: "cloud", providerId: "anthropic" },
		});
		expect(result.ok).toBe(true);
		const disk = loadOrSeedDriveFacets({ configParent: root });
		expect(disk["providers.sttId"]).toBe(BUILTIN_WEB_SPEECH_STT_ID);
		const raw = readFileSync(
			join(root, ".cline", "drive", "facets.v1.json"),
			"utf8",
		);
		expect(raw).not.toMatch(/apiKey|token/i);
		const parsed = JSON.parse(raw) as {
			schemaVersion: number;
			entries: Record<string, unknown>;
		};
		expect(parsed.schemaVersion).toBe(1);
		expect(parsed.entries["providers.sttId"]).toMatchObject({
			kind: "value",
			value: BUILTIN_WEB_SPEECH_STT_ID,
		});
	});
});
