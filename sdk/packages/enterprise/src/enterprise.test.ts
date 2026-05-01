import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createUserInstructionConfigService } from "@clinebot/core";
import type { AgentExtensionApi } from "@clinebot/shared";
import { describe, expect, it, vi } from "vitest";
import type {
	EnterpriseClaimsMapper,
	EnterpriseConfigBundle,
	EnterpriseControlPlane,
	EnterprisePolicyMaterializer,
	IdentityAdapter,
} from "./index";
import {
	createEnterprisePlugin,
	createEnterpriseRpcHandlers,
	createEnterpriseSessionMessagesArtifactUploader,
	ENTERPRISE_SESSION_BLOB_UPLOAD_METADATA_KEY,
	FileEnterpriseBundleStore,
	normalizeBundleTelemetry,
	prepareEnterpriseCoreIntegration,
	prepareEnterpriseRuntime,
	resolveEnterprisePaths,
} from "./index";

async function createTempWorkspace(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), "sdk-enterprise-"));
}

describe("sdk-enterprise", () => {
	it("prepares enterprise runtime by syncing, caching, and materializing files", async () => {
		const workspacePath = await createTempWorkspace();
		const identity: IdentityAdapter = {
			name: "test",
			async resolveIdentity() {
				return {
					claims: {
						subject: "user_123",
						email: "enterprise@example.com",
						organizationId: "org_123",
					},
					token: {
						accessToken: "token_123",
					},
				};
			},
		};

		const bundle: EnterpriseConfigBundle = {
			source: "test-control-plane",
			version: "bundle-v1",
			remoteConfig: {
				version: "v1",
				openTelemetryEnabled: true,
				openTelemetryOtlpEndpoint: "https://otel.example.com",
				globalRules: [
					{
						alwaysEnabled: true,
						name: "company.md",
						contents: "Follow company policy",
					},
				],
				globalWorkflows: [
					{
						alwaysEnabled: true,
						name: "release.md",
						contents: "Run release workflow",
					},
				],
			},
			managedInstructions: [
				{
					id: "skill:security-review",
					name: "security-review",
					kind: "skill",
					contents: "Use the security review checklist.",
				},
			],
		};
		const controlPlane: EnterpriseControlPlane = {
			name: "test-control-plane",
			async fetchBundle() {
				return bundle;
			},
		};

		const prepared = await prepareEnterpriseRuntime({
			workspacePath,
			identity,
			controlPlane,
			claimsMapper: {
				mapClaimsToRoles(claims) {
					return claims.organizationId ? ["org-member"] : [];
				},
			} satisfies EnterpriseClaimsMapper,
			requireBundle: true,
		});

		expect(prepared.bundle?.source).toBe("test-control-plane");
		expect(prepared.identity?.claims.subject).toBe("user_123");
		expect(prepared.telemetry?.enabled).toBe(true);
		expect(prepared.telemetry?.otlpEndpoint).toBe("https://otel.example.com");
		expect(prepared.roles).toEqual(["org-member"]);
		expect(prepared.claims?.organizationId).toBe("org_123");
		expect(prepared.workflowsDirectories).toEqual([
			prepared.paths.workflowsPath,
		]);
		expect(prepared.skillsDirectories).toEqual([prepared.paths.skillsPath]);

		const rulesText = await fs.readFile(prepared.paths.rulesFilePath, "utf8");
		expect(rulesText).toContain("Follow company policy");

		const workflowText = await fs.readFile(
			path.join(prepared.paths.workflowsPath, "release.md"),
			"utf8",
		);
		expect(workflowText).toContain("Run release workflow");

		const skillText = await fs.readFile(
			path.join(prepared.paths.skillsPath, "security-review", "SKILL.md"),
			"utf8",
		);
		expect(skillText).toContain("security review checklist");

		const cachedBundle = JSON.parse(
			await fs.readFile(prepared.paths.bundleCachePath, "utf8"),
		);
		expect(cachedBundle.source).toBe("test-control-plane");
	});

	it("falls back to the cached bundle when the control plane is unavailable", async () => {
		const workspacePath = await createTempWorkspace();
		const paths = resolveEnterprisePaths({ workspacePath });
		const bundleStore = new FileEnterpriseBundleStore(paths.bundleCachePath);
		await bundleStore.write({
			source: "cache",
			version: "cached",
			claims: {
				subject: "cached-user",
				roles: ["cached-role"],
			},
			remoteConfig: {
				version: "v1",
				globalRules: [
					{
						alwaysEnabled: true,
						name: "cached.md",
						contents: "Use cached enterprise rules",
					},
				],
			},
		});

		const prepared = await prepareEnterpriseRuntime({
			workspacePath,
			bundleStore,
			controlPlane: {
				name: "broken",
				async fetchBundle() {
					throw new Error("offline");
				},
			},
			useCachedBundle: true,
			requireBundle: true,
		});

		expect(prepared.bundle?.source).toBe("cache");
		expect(prepared.claims?.subject).toBe("cached-user");
		expect(prepared.roles).toEqual(["cached-role"]);
		const rulesText = await fs.readFile(paths.rulesFilePath, "utf8");
		expect(rulesText).toContain("Use cached enterprise rules");
	});

	it("does not materialize twice after a successful sync", async () => {
		const workspacePath = await createTempWorkspace();
		const materialize = vi.fn(async ({ paths }) => ({
			paths,
			files: [],
		}));
		const materializer = {
			materialize,
		} satisfies EnterprisePolicyMaterializer;

		await prepareEnterpriseRuntime({
			workspacePath,
			materializer,
			controlPlane: {
				name: "single-pass",
				async fetchBundle() {
					return {
						source: "single-pass",
						version: "1",
						remoteConfig: {
							version: "v1",
						},
					};
				},
			},
			requireBundle: true,
		});

		expect(materialize).toHaveBeenCalledTimes(1);
	});

	it("can create a plugin that syncs on setup and contributes prompt rules", async () => {
		const workspacePath = await createTempWorkspace();
		const paths = resolveEnterprisePaths({ workspacePath });
		const plugin = createEnterprisePlugin({
			workspacePath,
			controlPlane: {
				name: "syncing",
				async fetchBundle() {
					return {
						source: "syncing",
						version: "1",
						remoteConfig: {
							version: "v1",
							enterpriseTelemetry: {
								promptUploading: {
									enabled: true,
									type: "s3_access_keys",
									s3AccessSettings: {
										bucket: "enterprise-prompts",
										accessKeyId: "AKIAIOSFODNN7EXAMPLE",
										secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
										region: "us-east-1",
									},
								},
							},
							globalRules: [
								{
									alwaysEnabled: true,
									name: "runtime.md",
									contents: "Apply runtime enterprise guardrails",
								},
							],
						},
					};
				},
			},
		});

		const contributions = await plugin.setup?.({
			registerTool() {},
			registerCommand() {},
			registerMessageBuilder() {},
			registerProvider() {},
		} satisfies AgentExtensionApi);

		expect(contributions).toBeUndefined();
		const rulesText = await fs.readFile(paths.rulesFilePath, "utf8");
		expect(rulesText).toContain("runtime enterprise guardrails");
	});

	it("can prepare a core integration that wires watcher, telemetry, and extensions", async () => {
		const workspacePath = await createTempWorkspace();
		const integration = await prepareEnterpriseCoreIntegration({
			workspacePath,
			controlPlane: {
				name: "integration",
				async fetchBundle() {
					return {
						source: "integration",
						version: "1",
						telemetry: {
							enabled: true,
							otlpEndpoint: "https://telemetry.example.com",
						},
						remoteConfig: {
							version: "v1",
							enterpriseTelemetry: {
								promptUploading: {
									enabled: true,
									type: "s3_access_keys",
									s3AccessSettings: {
										bucket: "enterprise-prompts",
										accessKeyId: "AKIAIOSFODNN7EXAMPLE",
										secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
										region: "us-east-1",
									},
								},
							},
							globalRules: [
								{
									alwaysEnabled: true,
									name: "guardrails.md",
									contents: "Apply enterprise guardrails",
								},
							],
						},
						managedInstructions: [
							{
								id: "workflow:triage",
								name: "triage",
								kind: "workflow",
								contents: "Follow the triage workflow",
							},
						],
					};
				},
			},
		});

		try {
			const userInstructionService = createUserInstructionConfigService({
				skills: { workspacePath },
				rules: { workspacePath },
				workflows: { workspacePath },
			});
			await userInstructionService.start();
			const rules = userInstructionService.listRecords("rule");
			const workflows = userInstructionService.listRecords("workflow");
			expect(
				rules.some((rule) =>
					rule.item.instructions.includes("enterprise guardrails"),
				),
			).toBe(true);
			expect(
				workflows.some((workflow) =>
					workflow.item.instructions.includes("triage workflow"),
				),
			).toBe(true);
			userInstructionService.stop();

			const startInput = integration.applyToStartSessionInput({
				config: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
					apiKey: "test",
					cwd: workspacePath,
					workspaceRoot: workspacePath,
					systemPrompt: "You are concise.",
					mode: "act",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
				prompt: "hello",
				interactive: false,
			});

			expect(startInput.config.extensions).toHaveLength(1);
			expect(startInput.localRuntime?.userInstructionService).toBeUndefined();
			expect(startInput.config.telemetry).toBeDefined();
			expect(startInput.config.sessionId).toBeDefined();
			expect(startInput.sessionMetadata).toMatchObject({
				[ENTERPRISE_SESSION_BLOB_UPLOAD_METADATA_KEY]: {
					version: 1,
					storage: {
						adapterType: "s3",
						bucket: "enterprise-prompts",
					},
				},
			});
			expect(startInput.sessionMetadata).not.toMatchObject({
				[ENTERPRISE_SESSION_BLOB_UPLOAD_METADATA_KEY]: {
					storage: {
						accessKeyId: expect.any(String),
						secretAccessKey: expect.any(String),
					},
				},
			});
		} finally {
			await integration.dispose();
		}
	});

	it("requires an explicit enabled flag before prompt uploads are configured", async () => {
		const workspacePath = await createTempWorkspace();
		const integration = await prepareEnterpriseCoreIntegration({
			workspacePath,
			controlPlane: {
				name: "integration",
				async fetchBundle() {
					return {
						source: "integration",
						version: "1",
						remoteConfig: {
							version: "v1",
							enterpriseTelemetry: {
								promptUploading: {
									type: "s3_access_keys",
									s3AccessSettings: {
										bucket: "enterprise-prompts",
										accessKeyId: "AKIAIOSFODNN7EXAMPLE",
										secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
										region: "us-east-1",
									},
								},
							},
						},
					};
				},
			},
		});

		try {
			const startInput = integration.applyToStartSessionInput({
				config: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
					apiKey: "test",
					cwd: workspacePath,
					workspaceRoot: workspacePath,
					systemPrompt: "You are concise.",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
				prompt: "hello",
				interactive: false,
			});

			expect(startInput.sessionMetadata).toBeUndefined();
		} finally {
			await integration.dispose();
		}
	});

	it("uploads messages to blob storage with in-memory credentials only", async () => {
		const writes: Array<{ path: string; value: string }> = [];
		const uploader = createEnterpriseSessionMessagesArtifactUploader();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input, init) => {
			writes.push({
				path: String(input),
				value: Buffer.from(
					(init?.body as Uint8Array | undefined) ?? [],
				).toString("utf8"),
			});
			return new Response(null, { status: 201 });
		}) as typeof fetch;

		const workspacePath = await createTempWorkspace();
		const integration = await prepareEnterpriseCoreIntegration({
			workspacePath,
			controlPlane: {
				name: "integration",
				async fetchBundle() {
					return {
						source: "integration",
						version: "1",
						remoteConfig: {
							version: "v1",
							enterpriseTelemetry: {
								promptUploading: {
									enabled: true,
									type: "azure_access_keys",
									azureAccessSettings: {
										bucket: "chat-history",
										accessKeyId: "storage-account",
										secretAccessKey: Buffer.from("secret").toString("base64"),
										endpoint: "https://storage-account.blob.core.windows.net",
									},
								},
							},
						},
					};
				},
			},
		});

		try {
			const startInput = integration.applyToStartSessionInput({
				config: {
					sessionId: "session-123",
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
					apiKey: "test",
					cwd: workspacePath,
					workspaceRoot: workspacePath,
					systemPrompt: "You are concise.",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
				prompt: "hello",
				interactive: false,
			});
			await uploader.uploadMessagesFile({
				sessionId: "session-123",
				path: "/tmp/session-123.messages.json",
				contents: '{"messages":[]}\n',
				row: {
					sessionId: "session-123",
					source: "cli",
					pid: process.pid,
					startedAt: "2026-04-10T19:00:00.000Z",
					status: "running",
					statusLock: 0,
					interactive: false,
					provider: "anthropic",
					model: "claude-sonnet-4-6",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					isSubagent: false,
					messagesPath: "/tmp/session-123.messages.json",
					updatedAt: "2026-04-10T19:00:00.000Z",
					metadata: startInput.sessionMetadata,
				},
			});

			expect(writes).toHaveLength(1);
			expect(writes[0]?.path).toContain(
				"/chat-history/sessions/unknown/session-123/messages.json",
			);
			expect(writes[0]?.value).toContain('"messages":[]');

			await integration.dispose();
			await uploader.uploadMessagesFile({
				sessionId: "session-123",
				path: "/tmp/session-123.messages.json",
				contents: '{"messages":[{"role":"user"}]}\n',
				row: {
					sessionId: "session-123",
					source: "cli",
					pid: process.pid,
					startedAt: "2026-04-10T19:00:00.000Z",
					status: "running",
					statusLock: 0,
					interactive: false,
					provider: "anthropic",
					model: "claude-sonnet-4-6",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					isSubagent: false,
					messagesPath: "/tmp/session-123.messages.json",
					updatedAt: "2026-04-10T19:00:00.000Z",
					metadata: startInput.sessionMetadata,
				},
			});
		} finally {
			globalThis.fetch = originalFetch;
			await integration.dispose();
		}

		expect(writes).toHaveLength(1);
	});

	it("creates enterprise rpc handlers for authenticate, sync, and status", async () => {
		const workspacePath = await createTempWorkspace();
		const handlers = createEnterpriseRpcHandlers({
			identity: {
				name: "workos",
				async resolveIdentity(input) {
					return {
						token: { accessToken: "token_123" },
						claims: {
							subject: "user_123",
							roles: ["member"],
							organizationId: input.context?.organizationId,
						},
					};
				},
			},
			controlPlane: {
				name: "workos",
				async fetchBundle(input) {
					return {
						source: "workos",
						version: "bundle-v2",
						claims: input.identity?.claims,
						remoteConfig: {
							version: "v2",
							globalRules: [
								{
									alwaysEnabled: true,
									name: "policy.md",
									contents: "Follow enterprise policy",
								},
							],
						},
						managedInstructions: [
							{
								id: "workflow:incident",
								name: "incident",
								kind: "workflow",
								contents: "Run incident workflow",
							},
							{
								id: "skill:review",
								name: "review",
								kind: "skill",
								contents: "Review changes carefully",
							},
						],
						telemetry: {
							enabled: true,
							otlpEndpoint: "https://telemetry.example.com",
						},
					};
				},
			},
		});

		const auth = await handlers.enterpriseAuthenticate({
			providerId: "workos",
			workspacePath,
			organizationId: "org_123",
		});
		expect(auth.authenticated).toBe(true);
		expect(auth.roles).toEqual(["member"]);
		expect(auth.claims?.organizationId).toBe("org_123");

		const sync = await handlers.enterpriseSync({
			providerId: "workos",
			workspacePath,
			organizationId: "org_123",
		});
		expect(sync.appliedConfigVersion).toBe("bundle-v2");
		expect(sync.rulesCount).toBe(1);
		expect(sync.workflowsCount).toBe(1);
		expect(sync.skillsCount).toBe(1);
		expect(sync.hasTelemetryOverrides).toBe(true);

		const status = await handlers.enterpriseGetStatus({
			providerId: "workos",
			workspacePath,
		});
		expect(status.hasCachedBundle).toBe(true);
		expect(status.appliedConfigVersion).toBe("bundle-v2");
		expect(status.rulesCount).toBe(1);
	});

	it("normalizes bundle telemetry by whitelisting valid fields and types", () => {
		const telemetry = normalizeBundleTelemetry({
			enabled: "true",
			metricsExporter: "otlp",
			logsExporter: "console",
			otlpEndpoint: "https://telemetry.example.com",
			otlpHeaders: {
				authorization: "Bearer token",
				invalid: 123,
			},
			metricExportInterval: 5000,
			logBatchTimeout: "bad",
			unexpected: "ignored",
		});

		expect(telemetry).toEqual({
			metricsExporter: "otlp",
			logsExporter: "console",
			otlpEndpoint: "https://telemetry.example.com",
			otlpHeaders: {
				authorization: "Bearer token",
			},
			metricExportInterval: 5000,
		});
	});
});
