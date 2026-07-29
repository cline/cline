import { describe, expect, it } from "vitest";
import { parseAgentRef } from "./agentRef";
import { parseDriveFacetValues } from "./facetValues";
import {
	DRIVE_ENV_FORBIDDEN_SECRET_KEYS,
	parseDriveagentAgentYaml,
	parseDriveagentDerivedGraph,
	parseDriveagentEnvYaml,
	parseDriveagentHome,
	parseDriveagentPermissionsYaml,
} from "./home";

describe("AgentRefSchema", () => {
	it("accepts driveagent + builtin + configured (migration)", () => {
		expect(parseAgentRef({ kind: "driveagent", slug: "pair-partner" })).toEqual(
			{
				kind: "driveagent",
				slug: "pair-partner",
			},
		);
		expect(parseAgentRef({ kind: "builtin", id: "pair_partner" })).toEqual({
			kind: "builtin",
			id: "pair_partner",
		});
		expect(parseAgentRef({ kind: "configured", id: "legacy-agent" })).toEqual({
			kind: "configured",
			id: "legacy-agent",
		});
	});

	it("rejects invalid driveagent slug", () => {
		expect(() =>
			parseAgentRef({ kind: "driveagent", slug: "Bad_Slug" }),
		).toThrow();
	});

	it("rejects legacy configured.name shape", () => {
		expect(() =>
			parseAgentRef({ kind: "configured", name: "legacy" }),
		).toThrow();
	});
});

describe("parseDriveFacetValues pairAgent", () => {
	const base = {
		"runtime.profile": "cloud",
		"runtime.egressCeiling": "platform-cloud",
		"providers.sttId": "builtin.webSpeech",
		"providers.sttConfig": {},
		"providers.ttsId": "builtin.browserTts",
		"providers.ttsConfig": {},
		"tts.enabled": false,
		"tts.maxSpokenSentences": 3,
		"captions.enabled": true,
	} as const;

	it("parses a cloud seed shape", () => {
		const values = parseDriveFacetValues({
			...base,
			"drive.defaults.pairAgent": { kind: "builtin", id: "pair_partner" },
		});
		expect(values["runtime.profile"]).toBe("cloud");
	});

	it("accepts driveagent pairAgent refs", () => {
		const values = parseDriveFacetValues({
			...base,
			"drive.defaults.pairAgent": {
				kind: "driveagent",
				slug: "pair-partner",
			},
		});
		expect(values["drive.defaults.pairAgent"]).toEqual({
			kind: "driveagent",
			slug: "pair-partner",
		});
	});

	it("rejects apiKey in provider config", () => {
		expect(() =>
			parseDriveFacetValues({
				...base,
				"runtime.profile": "local",
				"runtime.egressCeiling": "loopback-only",
				"providers.sttId": "builtin.localWorkerStt",
				"providers.sttConfig": { apiKey: "nope" },
				"drive.defaults.pairAgent": {
					kind: "builtin",
					id: "pair_partner",
				},
			}),
		).toThrow(/apiKey/);
	});
});

describe("Driveagent home schemas", () => {
	const agent = {
		name: "pair-partner",
		description: "Default Drive pair partner",
		tools: ["read_file"],
		skills: ["drive-persona"],
		systemPrompt: "You are the pair partner.",
	};

	const permissions = {
		presetIntent: "standard" as const,
		approvalHooks: ["highImpact"],
		notes: "Intent only",
	};

	const env = {
		values: { DRIVE_NARRATION_DENSITY: "decision_points" },
		secretRefs: [] as Array<{ key: string; secretRef: string }>,
	};

	it("round-trips agent / permissions / env / home", () => {
		const parsedAgent = parseDriveagentAgentYaml(agent);
		const parsedPermissions = parseDriveagentPermissionsYaml(permissions);
		const parsedEnv = parseDriveagentEnvYaml(env);
		const home = parseDriveagentHome({
			slug: "pair-partner",
			agent: parsedAgent,
			permissions: parsedPermissions,
			env: parsedEnv,
		});
		const again = parseDriveagentHome(
			JSON.parse(JSON.stringify(home)) as unknown,
		);
		expect(again).toEqual(home);
	});

	it("accepts promptPath instead of systemPrompt", () => {
		const parsed = parseDriveagentAgentYaml({
			name: "pair-partner",
			description: "x",
			promptPath: "prompt.md",
		});
		expect(parsed.promptPath).toBe("prompt.md");
	});

	it("rejects plaintext secret keys in env values", () => {
		for (const key of DRIVE_ENV_FORBIDDEN_SECRET_KEYS) {
			expect(() =>
				parseDriveagentEnvYaml({
					values: { [key]: "leaked" },
					secretRefs: [],
				}),
			).toThrow(/secret/);
		}
	});

	it("accepts secretRef entries", () => {
		const parsed = parseDriveagentEnvYaml({
			values: {},
			secretRefs: [{ key: "API_TOKEN", secretRef: "vault://api-token" }],
		});
		expect(parsed.secretRefs[0]?.secretRef).toBe("vault://api-token");
	});

	it("rejects slug / agent.name mismatch", () => {
		expect(() =>
			parseDriveagentHome({
				slug: "other-slug",
				agent,
				permissions,
				env,
			}),
		).toThrow(/match/);
	});

	it("round-trips derived graph", () => {
		const graph = parseDriveagentDerivedGraph({
			version: 1,
			agentSlug: "pair-partner",
			compiledAt: "2026-07-25T00:00:00.000Z",
			nodes: [
				{ id: "agent-self", kind: "concept", label: "Pair partner" },
			],
			edges: [],
		});
		expect(
			parseDriveagentDerivedGraph(
				JSON.parse(JSON.stringify(graph)) as unknown,
			),
		).toEqual(graph);
	});
});
