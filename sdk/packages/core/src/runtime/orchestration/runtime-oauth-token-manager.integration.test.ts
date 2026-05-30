import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import {
	OAuthReauthRequiredError,
	RuntimeOAuthTokenManager,
} from "./runtime-oauth-token-manager";

const workerPath = fileURLToPath(
	new URL("./fixtures/runtime-oauth-token-worker.ts", import.meta.url),
);
const currentDir = dirname(fileURLToPath(import.meta.url));

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function createTokenResponse(
	accessToken = "access-new",
	refreshToken = "refresh-new",
): Response {
	return new Response(
		JSON.stringify({
			access_token: accessToken,
			refresh_token: refreshToken,
			expires_in: 3600,
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}

function createInvalidGrantResponse(): Response {
	return new Response(
		JSON.stringify({
			error: "invalid_grant",
			error_description: "refresh token already used",
		}),
		{ status: 400, headers: { "Content-Type": "application/json" } },
	);
}

function readSubmittedRefreshToken(init?: RequestInit): string | null {
	return new URLSearchParams(init?.body?.toString()).get("refresh_token");
}

function createSettings(
	accessToken = "access-old",
	refreshToken = "refresh-old",
	expiresAt = Date.now() - 1_000,
) {
	return {
		provider: "openai-codex" as const,
		auth: {
			accessToken,
			refreshToken,
			expiresAt,
			accountId: "acct-old",
		},
	};
}

function seedSettings(filePath: string): ProviderSettingsManager {
	const manager = new ProviderSettingsManager({ filePath });
	manager.saveProviderSettings(createSettings(), { tokenSource: "oauth" });
	return manager;
}

function runWorker(
	filePath: string,
	tokenEndpoint: string,
): Promise<{ apiKey: string } | null> {
	return new Promise((resolve, reject) => {
		const child = spawn("bun", [workerPath, filePath, tokenEndpoint], {
			cwd: join(currentDir, "../../../../.."),
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`Worker exited ${code}: ${stderr}`));
				return;
			}
			resolve(JSON.parse(stdout) as { apiKey: string } | null);
		});
	});
}

async function listen(server: Server): Promise<string> {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Expected TCP server address");
	}
	return `http://127.0.0.1:${address.port}/token`;
}

async function close(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

describe("RuntimeOAuthTokenManager Codex refresh transaction", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function createFilePath(): string {
		const dir = mkdtempSync(join(tmpdir(), "cline-runtime-oauth-"));
		tempDirs.push(dir);
		return join(dir, "settings", "providers.json");
	}

	it("serializes two runtime managers sharing providers.json", async () => {
		const filePath = createFilePath();
		seedSettings(filePath);
		const submissions: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
				submissions.push(readSubmittedRefreshToken(init) ?? "");
				return createTokenResponse();
			}),
		);
		const first = new RuntimeOAuthTokenManager({
			providerSettingsManager: new ProviderSettingsManager({ filePath }),
		});
		const second = new RuntimeOAuthTokenManager({
			providerSettingsManager: new ProviderSettingsManager({ filePath }),
		});

		await expect(
			Promise.all([
				first.resolveProviderApiKey({ providerId: "openai-codex" }),
				second.resolveProviderApiKey({ providerId: "openai-codex" }),
			]),
		).resolves.toMatchObject([
			{ apiKey: "access-new" },
			{ apiKey: "access-new" },
		]);
		expect(submissions).toEqual(["refresh-old"]);
	});

	it("does not restore a consumed refresh token from a stale settings save", async () => {
		const filePath = createFilePath();
		const storedManager = seedSettings(filePath);
		const staleSettings =
			storedManager.getProviderSettings("openai-codex") ?? createSettings();
		const submissions: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
				submissions.push(readSubmittedRefreshToken(init) ?? "");
				return createTokenResponse();
			}),
		);
		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: new ProviderSettingsManager({ filePath }),
		});

		await expect(
			manager.resolveProviderApiKey({ providerId: "openai-codex" }),
		).resolves.toMatchObject({ apiKey: "access-new" });
		storedManager.saveProviderSettings({
			...staleSettings,
			model: "gpt-5.4",
		});
		await expect(
			new RuntimeOAuthTokenManager({
				providerSettingsManager: new ProviderSettingsManager({ filePath }),
			}).resolveProviderApiKey({ providerId: "openai-codex" }),
		).resolves.toMatchObject({ apiKey: "access-new" });
		expect(submissions).toEqual(["refresh-old"]);
		expect(storedManager.getProviderSettings("openai-codex")).toMatchObject({
			model: "gpt-5.4",
			auth: {
				accessToken: "access-new",
				refreshToken: "refresh-new",
			},
		});
	});

	it("lets a forced waiter adopt another manager's rotated credentials", async () => {
		const filePath = createFilePath();
		const manager = seedSettings(filePath);
		manager.saveProviderSettings(
			createSettings(
				"access-current",
				"refresh-current",
				Date.now() + 3_600_000,
			),
			{ tokenSource: "oauth" },
		);
		const submissions: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
				submissions.push(readSubmittedRefreshToken(init) ?? "");
				return createTokenResponse();
			}),
		);
		const first = new RuntimeOAuthTokenManager({
			providerSettingsManager: new ProviderSettingsManager({ filePath }),
		});
		const second = new RuntimeOAuthTokenManager({
			providerSettingsManager: new ProviderSettingsManager({ filePath }),
		});

		await expect(
			Promise.all([
				first.resolveProviderApiKey({
					providerId: "openai-codex",
					forceRefresh: true,
				}),
				second.resolveProviderApiKey({
					providerId: "openai-codex",
					forceRefresh: true,
				}),
			]),
		).resolves.toMatchObject([
			{ apiKey: "access-new" },
			{ apiKey: "access-new" },
		]);
		expect(submissions).toEqual(["refresh-current"]);
	});

	it("keeps the lock alive while a delayed refresh response is in flight", async () => {
		const filePath = createFilePath();
		seedSettings(filePath);
		const submissions: string[] = [];
		const responseGate = createDeferred();
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
				submissions.push(readSubmittedRefreshToken(init) ?? "");
				await responseGate.promise;
				return createTokenResponse();
			}),
		);
		const lockOptions = { staleMs: 2_000, updateMs: 1_000 };
		const first = new RuntimeOAuthTokenManager({
			providerSettingsManager: new ProviderSettingsManager({ filePath }),
			refreshLockOptions: lockOptions,
		});
		const second = new RuntimeOAuthTokenManager({
			providerSettingsManager: new ProviderSettingsManager({ filePath }),
			refreshLockOptions: lockOptions,
		});

		const firstResolution = first.resolveProviderApiKey({
			providerId: "openai-codex",
		});
		await vi.waitFor(() => {
			expect(submissions).toEqual(["refresh-old"]);
		});
		await new Promise((resolve) => setTimeout(resolve, 2_400));
		const secondResolution = second.resolveProviderApiKey({
			providerId: "openai-codex",
		});
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(submissions).toEqual(["refresh-old"]);

		responseGate.resolve();
		await expect(
			Promise.all([firstResolution, secondResolution]),
		).resolves.toMatchObject([
			{ apiKey: "access-new" },
			{ apiKey: "access-new" },
		]);
		expect(submissions).toEqual(["refresh-old"]);
	}, 10_000);

	it("preserves newer stored auth after a stale invalid_grant response", async () => {
		const filePath = createFilePath();
		const externalManager = seedSettings(filePath);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				externalManager.saveProviderSettings(
					createSettings(
						"access-winner",
						"refresh-winner",
						Date.now() + 3_600_000,
					),
					{ tokenSource: "oauth" },
				);
				return createInvalidGrantResponse();
			}),
		);
		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: new ProviderSettingsManager({ filePath }),
		});

		await expect(
			manager.resolveProviderApiKey({ providerId: "openai-codex" }),
		).rejects.toBeInstanceOf(OAuthReauthRequiredError);
		expect(
			externalManager.getProviderSettings("openai-codex")?.auth,
		).toMatchObject({
			accessToken: "access-winner",
			refreshToken: "refresh-winner",
		});
	});

	it("preserves newer stored auth with the same refresh token after a stale invalid_grant response", async () => {
		const filePath = createFilePath();
		const externalManager = seedSettings(filePath);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				externalManager.saveProviderSettings(
					createSettings(
						"access-winner",
						"refresh-old",
						Date.now() + 3_600_000,
					),
					{ tokenSource: "oauth" },
				);
				return createInvalidGrantResponse();
			}),
		);
		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: new ProviderSettingsManager({ filePath }),
		});

		await expect(
			manager.resolveProviderApiKey({ providerId: "openai-codex" }),
		).rejects.toBeInstanceOf(OAuthReauthRequiredError);
		expect(
			externalManager.getProviderSettings("openai-codex")?.auth,
		).toMatchObject({
			accessToken: "access-winner",
			refreshToken: "refresh-old",
		});
	});

	it("clears rejected auth when durable credentials still match", async () => {
		const filePath = createFilePath();
		const storedManager = seedSettings(filePath);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => createInvalidGrantResponse()),
		);
		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: new ProviderSettingsManager({ filePath }),
		});

		await expect(
			manager.resolveProviderApiKey({ providerId: "openai-codex" }),
		).rejects.toBeInstanceOf(OAuthReauthRequiredError);
		expect(
			storedManager.getProviderSettings("openai-codex")?.auth,
		).toBeUndefined();
	});

	it("preserves stored auth after a transient refresh failure", async () => {
		const filePath = createFilePath();
		const storedManager = seedSettings(filePath);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: "server_error",
							error_description: "try again",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					),
			),
		);
		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: new ProviderSettingsManager({ filePath }),
		});

		await expect(
			manager.resolveProviderApiKey({ providerId: "openai-codex" }),
		).rejects.toBeInstanceOf(OAuthReauthRequiredError);
		expect(
			storedManager.getProviderSettings("openai-codex")?.auth,
		).toMatchObject({
			accessToken: "access-old",
			refreshToken: "refresh-old",
		});
	});

	it("serializes spawned workers sharing providers.json", async () => {
		const filePath = createFilePath();
		seedSettings(filePath);
		const submissions: string[] = [];
		const server = createServer((request, response) => {
			let body = "";
			request.setEncoding("utf8");
			request.on("data", (chunk) => {
				body += chunk;
			});
			request.on("end", () => {
				submissions.push(new URLSearchParams(body).get("refresh_token") ?? "");
				response.writeHead(200, { "Content-Type": "application/json" });
				response.end(
					JSON.stringify({
						access_token: "access-new",
						refresh_token: "refresh-new",
						expires_in: 3600,
					}),
				);
			});
		});
		const tokenEndpoint = await listen(server);
		try {
			await expect(
				Promise.all([
					runWorker(filePath, tokenEndpoint),
					runWorker(filePath, tokenEndpoint),
				]),
			).resolves.toMatchObject([
				{ apiKey: "access-new" },
				{ apiKey: "access-new" },
			]);
		} finally {
			await close(server);
		}
		expect(submissions).toEqual(["refresh-old"]);
	}, 15_000);
});
