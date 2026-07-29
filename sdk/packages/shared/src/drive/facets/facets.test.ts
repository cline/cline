import { describe, expect, it } from "vitest";
import {
	AgentAppearanceSchema,
	AgentProfileSchema,
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

const appearanceBase = {
	nameInk: { kind: "token" as const, token: "foreground" as const },
	bodyInk: { kind: "token" as const, token: "muted" as const },
};

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
				...appearanceBase,
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

describe("AgentProfileSchema no-prompt invariant", () => {
	const profileBase = {
		id: "partner",
		ref: { kind: "driveagent" as const, slug: "pair-partner" },
		...appearanceBase,
	};

	it("accepts appearance-only profile with AgentRef", () => {
		const profile = AgentProfileSchema.parse({
			...profileBase,
			displayName: "Partner",
		});
		expect(profile.ref).toEqual({
			kind: "driveagent",
			slug: "pair-partner",
		});
	});

	it("rejects systemPrompt, tools, skills, providerId, modelId", () => {
		for (const key of [
			"systemPrompt",
			"tools",
			"skills",
			"providerId",
			"modelId",
		] as const) {
			const result = AgentProfileSchema.safeParse({
				...profileBase,
				[key]: key === "tools" || key === "skills" ? [] : "nope",
			});
			expect(result.success).toBe(false);
		}
	});

	it("rejects every DRIVE_FACET_FORBIDDEN_PROMPT_KEYS entry", () => {
		for (const key of DRIVE_FACET_FORBIDDEN_PROMPT_KEYS) {
			const result = AgentProfileSchema.safeParse({
				...profileBase,
				[key]: "should-not-persist",
			});
			expect(result.success).toBe(false);
		}
	});
});

describe("facet document no-prompt invariant", () => {
	it("rejects forbidden keys nested in agent.appearance map values via profile schema", () => {
		const disk = parseDriveFacetDiskFile({
			schemaVersion: 1,
			entries: {
				"agent.appearance": {
					kind: "map",
					entries: {
						partner: {
							kind: "value",
							value: {
								...appearanceBase,
								displayName: "Partner",
							},
						},
					},
				},
			},
		});
		const appearance = disk.entries["agent.appearance"];
		expect(appearance?.kind).toBe("map");
		if (appearance?.kind !== "map") {
			return;
		}
		const entry = appearance.entries.partner;
		expect(entry?.kind).toBe("value");
		if (entry?.kind !== "value") {
			return;
		}
		expect(AgentAppearanceSchema.safeParse(entry.value).success).toBe(true);
		for (const key of DRIVE_FACET_FORBIDDEN_PROMPT_KEYS) {
			expect(
				AgentAppearanceSchema.safeParse({
					...(entry.value as object),
					[key]: "nope",
				}).success,
			).toBe(false);
		}
	});
});

function InkLikeHexRejected(value: unknown): boolean {
	return !AgentAppearanceSchema.safeParse(value).success;
}
