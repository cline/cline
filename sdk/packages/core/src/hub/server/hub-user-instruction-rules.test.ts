import type { AgentExtension } from "@cline/shared";
import { describe, expect, it } from "vitest";
import type { RuleConfig } from "../../extensions/config/user-instruction-config-loader";
import {
	combineUserInstructionConfigServices,
	createUserInstructionConfigService,
	type UserInstructionConfigService,
} from "../../extensions/config/user-instruction-service";
import {
	createHubClientContributionRuntime,
	HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY,
} from "./hub-client-contributions";

function ruleRecord(name: string, extra: Partial<RuleConfig> = {}) {
	return {
		type: "rule",
		id: name,
		filePath: `/client/.clinerules/${name}.md`,
		item: {
			name,
			instructions: `${name} instructions`,
			frontmatter: {},
			...extra,
		},
	};
}

async function hubClientInstructionService(
	rules: ReturnType<typeof ruleRecord>[],
): Promise<UserInstructionConfigService> {
	const runtime = createHubClientContributionRuntime({
		sessionId: "session-1",
		targetClientId: "client-1",
		contributions: [
			{
				kind: "userInstructionService",
				capabilityName: HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY,
			},
		],
		requestCapability: async () => ({
			snapshot: {
				records: { rule: rules, skill: [], workflow: [] },
				runtimeCommands: [],
			},
		}),
	});
	const service = runtime.localRuntime.userInstructionService;
	if (!service) {
		throw new Error("hub runtime did not create a user-instruction proxy");
	}
	await service.start();
	return service;
}

/** The rules section a session's system prompt gets from this service. */
function renderRules(service: UserInstructionConfigService): string {
	let content: (() => string) | undefined;
	const extension: AgentExtension = service.createExtension({
		includeRules: true,
		includeSkills: false,
		includeWorkflows: false,
		registerSkillsTool: false,
	});
	extension.setup?.(
		{
			registerRule: (rule: { content: () => string }) => {
				content = rule.content;
			},
			registerTool: () => {},
			registerCommand: () => {},
		} as never,
		{} as never,
	);
	if (!content) {
		throw new Error("service registered no rules");
	}
	return content();
}

describe("hub client rules in the session prompt", () => {
	it("renders the same enabled rules, in the same order, with or without a host plugin service", async () => {
		const proxy = await hubClientInstructionService([
			ruleRecord("zeta"),
			ruleRecord("alpha"),
			ruleRecord("off", { disabled: true }),
		]);
		// What runtime-builder does when host plugin skills are present: wrap the
		// client proxy in the combined service next to a plugin service that
		// contributes no rules.
		const combined = combineUserInstructionConfigServices([
			proxy,
			createUserInstructionConfigService({
				skills: { directories: [] },
				rules: { directories: [] },
				workflows: { directories: [] },
			}),
		]);

		const expected =
			"\n\n# Rules\n## alpha\nalpha instructions\n\n## zeta\nzeta instructions";
		expect(renderRules(proxy)).toBe(expected);
		expect(renderRules(combined)).toBe(expected);
	});
});
