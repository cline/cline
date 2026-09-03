import { describe, expect, it } from "bun:test";
import { CloudAgentSpawner } from "./cloud-agent.js";

describe("CloudAgentSpawner", () => {
	it("provisions a workspace, creates an inner session, and sends the task", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const commands: Array<{
			name: string;
			payload: unknown;
			sessionId?: string;
		}> = [];
		let disposed = false;
		const spawner = new CloudAgentSpawner({
			resolveAuthToken: async () => "test-token",
			resolveEnvironment: () => ({
				apiBaseUrl: "https://api.example.test",
				appBaseUrl: "https://app.example.test/",
			}),
			fetch: (async (url: string | URL | Request, init?: RequestInit) => {
				requests.push({ url: String(url), init });
				if (String(url).endsWith("/api/v1/session")) {
					return Response.json({
						data: { sessionId: "ses-cloud", status: "provisioning" },
					});
				}
				return Response.json({ data: { status: "ready" } });
			}) as typeof fetch,
			createHubClient: () =>
				({
					connect: async () => undefined,
					command: async (
						name: string,
						payload: unknown,
						sessionId?: string,
					) => {
						commands.push({ name, payload, sessionId });
						return name === "session.create"
							? { ok: true, payload: { sessionId: "inner-agent" } }
							: { ok: true, payload: {} };
					},
					dispose: async () => {
						disposed = true;
					},
				}) as never,
			sleep: async () => undefined,
		});

		const started = spawner.startSpawn({
			prompt: "Fix the parser tests",
			repoUrl: "https://github.com/acme/widgets",
			branch: "main",
			modelId: "anthropic/claude-sonnet-4.6",
			organizationId: null,
		});
		let result = spawner.getSpawnStatus(started.operationId);
		for (
			let attempt = 0;
			result.status === "pending" && attempt < 20;
			attempt++
		) {
			await Promise.resolve();
			result = spawner.getSpawnStatus(started.operationId);
		}

		expect(result).toEqual({
			operationId: started.operationId,
			cloudSessionId: "ses-cloud",
			agentSessionId: "inner-agent",
			dashboardUrl: "https://app.example.test/agents?sessionId=ses-cloud",
			status: "running",
		});
		expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
			modelId: "anthropic/claude-sonnet-4.6",
			repoUrl: "https://github.com/acme/widgets",
			branch: "main",
		});
		expect(commands.map(({ name }) => name)).toEqual([
			"session.create",
			"session.attach",
			"session.send_input",
		]);
		expect(commands[2]).toMatchObject({
			payload: { prompt: "Fix the parser tests" },
			sessionId: "inner-agent",
		});
		expect(disposed).toBe(true);
	});

	it("fails before provisioning when Cline authentication is unavailable", async () => {
		const spawner = new CloudAgentSpawner({
			resolveAuthToken: async () => undefined,
		});

		const started = spawner.startSpawn({
			prompt: "Do work",
			repoUrl: "https://github.com/acme/widgets",
			modelId: "model",
		});
		let result = spawner.getSpawnStatus(started.operationId);
		for (
			let attempt = 0;
			result.status === "pending" && attempt < 20;
			attempt++
		) {
			await new Promise((resolve) => setTimeout(resolve, 0));
			result = spawner.getSpawnStatus(started.operationId);
		}
		expect(result).toMatchObject({
			operationId: started.operationId,
			status: "failed",
			error: expect.stringContaining("Cline authentication is required"),
		});
	});

	it("starts device OAuth and persists completed Cline credentials", async () => {
		let savedSettings: unknown;
		const spawner = new CloudAgentSpawner({
			resolveEnvironment: () => ({
				apiBaseUrl: "https://api.example.test",
				appBaseUrl: "https://app.example.test",
			}),
			providerSettingsManager: {
				getProviderSettings: () => undefined,
				saveProviderSettings: (settings: unknown) => {
					savedSettings = settings;
				},
			} as never,
			startDeviceAuth: async () => ({
				deviceCode: "device-code",
				userCode: "ABCD-EFGH",
				verificationUri: "https://login.example.test/device",
				verificationUriComplete:
					"https://login.example.test/device?code=ABCD-EFGH",
				expiresInSeconds: 600,
				pollIntervalSeconds: 1,
			}),
			completeDeviceAuth: async () => ({
				access: "access-token",
				refresh: "refresh-token",
				expires: Date.now() + 60_000,
				accountId: "account-1",
			}),
		});

		const started = await spawner.startOAuth();
		expect(started).toMatchObject({
			status: "pending",
			userCode: "ABCD-EFGH",
			verificationUrl: "https://login.example.test/device?code=ABCD-EFGH",
		});
		await Promise.resolve();
		expect(spawner.getOAuthStatus(started.flowId)).toEqual({
			flowId: started.flowId,
			status: "authenticated",
		});
		expect(savedSettings).toMatchObject({
			provider: "cline",
			auth: {
				accessToken: "workos:access-token",
				refreshToken: "refresh-token",
				accountId: "account-1",
			},
		});
	});
});
