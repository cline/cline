import { describe, expect, it, vi } from "vitest";
import { prepareLocalRuntimeBootstrap } from "./local-runtime-bootstrap";

vi.mock("./workspace/workspace-manifest", () => ({
	buildWorkspaceMetadataWithInfo: vi.fn(async (rootPath: string) => ({
		workspaceInfo: {
			rootPath,
			git: undefined,
			remotes: [],
			branch: undefined,
			commit: undefined,
		},
		workspaceMetadata: "",
		gitState: {
			isGitRepo: false,
			branch: undefined,
			commit: undefined,
			remoteUrls: [],
		},
	})),
}));

describe("local Bedrock startup", () => {
	it("boots without an account or remote feature-flag service", async () => {
		const result = await prepareLocalRuntimeBootstrap({
			input: {
				config: {
					providerId: "bedrock",
					modelId: "us.anthropic.claude-sonnet-4-20250514-v1:0",
					cwd: "/tmp/bedrock-startup",
					workspaceRoot: "/tmp/bedrock-startup",
					systemPrompt: "system",
					mode: "act",
					enableTools: true,
					enableSpawnAgent: true,
					enableAgentTeams: true,
				},
			},
			sessionId: "bedrock-startup",
			providerSettingsManager: {
				getProviderSettings: vi.fn(() => ({
					provider: "bedrock",
					connection: { region: "us-east-1", profile: "developer" },
				})),
			} as never,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool: () => ({
				name: "spawn",
				description: "",
				inputSchema: {},
				execute: vi.fn(),
			}),
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(result.providerConfig.providerId).toBe("bedrock");
		expect(result.providerConfig.connection).toMatchObject({
			region: "us-east-1",
			profile: "developer",
		});
		expect(result.config.extensionContext).toMatchObject({
			session: { sessionId: "bedrock-startup" },
		});
		expect(result.config.extensionContext).not.toHaveProperty("user");
	});
});
