import { describe, expect, it } from "vitest";
import {
	AgentAppearanceSchema,
	DRIVE_FACET_FORBIDDEN_PROMPT_KEYS,
	emptyFacetDiskSnapshot,
	mergeFacetScopes,
	parseDriveFacetDiskFile,
	UnknownFacetSchemaVersionError,
} from "./index";

describe("parseDriveFacetDiskFile", () => {
	it("parses a v1 envelope", () => {
		const file = parseDriveFacetDiskFile({
			schemaVersion: 1,
			entries: {
				"drive.defaults.subMode": { kind: "value", value: "act" },
			},
		});
		expect(file.entries["drive.defaults.subMode"]).toEqual({
			kind: "value",
			value: "act",
		});
	});

	it("rejects an unknown schemaVersion major with a named error", () => {
		expect(() =>
			parseDriveFacetDiskFile({
				schemaVersion: 99,
				entries: {},
			}),
		).toThrow(UnknownFacetSchemaVersionError);
	});
});

describe("mergeFacetScopes", () => {
	it("applies workspace-over-user precedence", () => {
		const merged = mergeFacetScopes(
			{
				schemaVersion: 1,
				entries: {
					"drive.defaults.subMode": { kind: "value", value: "plan" },
				},
			},
			{
				schemaVersion: 1,
				entries: {
					"drive.defaults.subMode": { kind: "value", value: "debug" },
				},
			},
		);
		expect(merged.values["drive.defaults.subMode"]).toBe("debug");
	});

	it("inherits user value when workspace key is absent", () => {
		const merged = mergeFacetScopes(
			{
				schemaVersion: 1,
				entries: {
					"drive.defaults.subMode": { kind: "value", value: "ask" },
				},
			},
			{ schemaVersion: 1, entries: {} },
		);
		expect(merged.values["drive.defaults.subMode"]).toBe("ask");
	});

	it("hides user value behind a workspace tombstone", () => {
		const merged = mergeFacetScopes(
			{
				schemaVersion: 1,
				entries: {
					"drive.defaults.subMode": { kind: "value", value: "plan" },
					"agent.appearance": {
						kind: "map",
						entries: {
							partner: {
								kind: "value",
								value: {
									nameInk: { kind: "token", token: "foreground" },
									bodyInk: { kind: "token", token: "muted" },
								},
							},
						},
					},
				},
			},
			{
				schemaVersion: 1,
				entries: {
					"drive.defaults.subMode": { kind: "tombstone" },
					"agent.appearance": {
						kind: "map",
						entries: {
							partner: { kind: "tombstone" },
						},
					},
				},
			},
		);
		expect(merged.values["drive.defaults.subMode"]).toBeUndefined();
		expect(merged.maps["agent.appearance"]?.partner).toBeUndefined();
	});

	it("returns an empty snapshot for null scopes", () => {
		expect(mergeFacetScopes(null, null)).toEqual(emptyFacetDiskSnapshot());
	});
});

describe("AgentAppearanceSchema privacy", () => {
	it("accepts ink-only appearance", () => {
		const value = AgentAppearanceSchema.parse({
			displayName: "Partner",
			nameInk: { kind: "palette", index: 3 },
			bodyInk: { kind: "token", token: "muted" },
		});
		expect(value.displayName).toBe("Partner");
	});

	it("rejects prompt / tool / model fields (DEC-agent-SoT)", () => {
		for (const key of DRIVE_FACET_FORBIDDEN_PROMPT_KEYS) {
			const result = AgentAppearanceSchema.safeParse({
				nameInk: { kind: "token", token: "foreground" },
				bodyInk: { kind: "token", token: "muted" },
				[key]: "should-not-persist",
			});
			expect(result.success).toBe(false);
		}
	});

	it("rejects raw hex ink", () => {
		expect(
			InkLikeHexRejected({
				nameInk: { kind: "hex", hex: "#ff00ff" },
				bodyInk: { kind: "token", token: "muted" },
			}),
		).toBe(true);
	});
});

function InkLikeHexRejected(value: unknown): boolean {
	return !AgentAppearanceSchema.safeParse(value).success;
}
