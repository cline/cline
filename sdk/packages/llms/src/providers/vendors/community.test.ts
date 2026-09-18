import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createClaudeCodeProviderModule,
	createSapAiCoreProviderModule,
} from "./community";

const claudeCodeMock = vi.hoisted(() => ({
	createClaudeCode: vi.fn(() => vi.fn()),
	resolveBundledPackage: vi.fn<(specifier: string) => string>(),
}));

vi.mock("node:module", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:module")>();
	return {
		...actual,
		createRequire: () => ({ resolve: claudeCodeMock.resolveBundledPackage }),
	};
});

// The real provider runs createClaudeCode() at module scope and validates
// settings against the filesystem. Mocking it keeps these tests about the
// executable resolution this module owns, and lets them assert the exact
// settings handed to the provider.
vi.mock("ai-sdk-provider-claude-code", () => ({
	createClaudeCode: claudeCodeMock.createClaudeCode,
}));

const originalServiceKey = process.env.AICORE_SERVICE_KEY;

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("createSapAiCoreProviderModule", () => {
	afterEach(() => {
		if (originalServiceKey === undefined) {
			delete process.env.AICORE_SERVICE_KEY;
		} else {
			process.env.AICORE_SERVICE_KEY = originalServiceKey;
		}
	});

	it("uses SAP service-key credentials without mutating process env", async () => {
		process.env.AICORE_SERVICE_KEY = "existing-service-key";

		const provider = await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
			options: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://auth.example/oauth/token",
				deploymentId: "deployment-id",
			},
		});

		const model = provider.operations.language(
			"anthropic--claude-4.6-sonnet",
		) as {
			config?: {
				destination?: Record<string, unknown>;
				deploymentConfig?: Record<string, unknown>;
				providerApi?: string;
			};
		};

		expect(process.env.AICORE_SERVICE_KEY).toBe("existing-service-key");
		expect(model.config?.destination).toBeUndefined();
		expect(model.config?.deploymentConfig).toMatchObject({
			deploymentId: "deployment-id",
		});
		expect(model.config?.providerApi).toBe("orchestration");
	});

	it("sets SAP service-key credentials while model methods run", async () => {
		process.env.AICORE_SERVICE_KEY = "existing-service-key";

		const provider = await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com/",
			options: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://auth.example/oauth/token",
			},
		});

		const model = provider.operations.language(
			"anthropic--claude-4.6-sonnet",
		) as {
			doGenerate: () => Promise<string>;
		};
		let observedServiceKey: string | undefined;
		model.doGenerate = async () => {
			observedServiceKey = process.env.AICORE_SERVICE_KEY;
			return "ok";
		};

		await expect(model.doGenerate()).resolves.toBe("ok");
		expect(JSON.parse(observedServiceKey ?? "{}")).toMatchObject({
			clientid: "sap-client",
			clientsecret: "sap-secret",
			serviceurls: {
				AI_API_URL: "https://api.ai.example.aws.ml.hana.ondemand.com",
			},
			url: "https://auth.example",
		});
		expect(process.env.AICORE_SERVICE_KEY).toBe("existing-service-key");
	});

	it("serializes concurrent SAP service-key model calls", async () => {
		process.env.AICORE_SERVICE_KEY = "existing-service-key";

		const firstProvider = await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://first.ai.example.aws.ml.hana.ondemand.com",
			options: {
				clientId: "first-client",
				clientSecret: "first-secret",
				tokenUrl: "https://first-auth.example",
			},
		});
		const secondProvider = await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://second.ai.example.aws.ml.hana.ondemand.com",
			options: {
				clientId: "second-client",
				clientSecret: "second-secret",
				tokenUrl: "https://second-auth.example",
			},
		});

		const firstModel = firstProvider.operations.language(
			"anthropic--claude-4.6-sonnet",
		) as {
			doGenerate: () => Promise<string>;
		};
		const secondModel = secondProvider.operations.language(
			"anthropic--claude-4.6-sonnet",
		) as {
			doGenerate: () => Promise<string>;
		};
		const firstStarted = deferred();
		const releaseFirst = deferred();
		let firstServiceKey: string | undefined;
		let firstServiceKeyBeforeReturn: string | undefined;
		let secondServiceKey: string | undefined;
		let secondStarted = false;

		firstModel.doGenerate = async () => {
			firstServiceKey = process.env.AICORE_SERVICE_KEY;
			firstStarted.resolve();
			await releaseFirst.promise;
			firstServiceKeyBeforeReturn = process.env.AICORE_SERVICE_KEY;
			return "first";
		};
		secondModel.doGenerate = async () => {
			secondStarted = true;
			secondServiceKey = process.env.AICORE_SERVICE_KEY;
			return "second";
		};

		const firstResult = firstModel.doGenerate();
		await firstStarted.promise;
		const secondResult = secondModel.doGenerate();
		await Promise.resolve();
		await Promise.resolve();

		expect(secondStarted).toBe(false);
		expect(JSON.parse(firstServiceKey ?? "{}")).toMatchObject({
			clientid: "first-client",
		});

		releaseFirst.resolve();
		await expect(firstResult).resolves.toBe("first");
		await expect(secondResult).resolves.toBe("second");

		expect(JSON.parse(firstServiceKeyBeforeReturn ?? "{}")).toMatchObject({
			clientid: "first-client",
		});
		expect(JSON.parse(secondServiceKey ?? "{}")).toMatchObject({
			clientid: "second-client",
		});
		expect(process.env.AICORE_SERVICE_KEY).toBe("existing-service-key");
	});

	it("uses resource group deployment resolution for orchestration mode", async () => {
		const provider = await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
			options: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://auth.example",
				resourceGroup: "default",
				useOrchestrationMode: true,
			},
		});

		const model = provider.operations.language(
			"anthropic--claude-4.6-sonnet",
		) as {
			config?: {
				deploymentConfig?: Record<string, unknown>;
				providerApi?: string;
			};
		};

		expect(model.config?.deploymentConfig).toMatchObject({
			resourceGroup: "default",
		});
		expect(model.config?.deploymentConfig).not.toHaveProperty("deploymentId");
		expect(model.config?.providerApi).toBe("orchestration");
	});

	it("sets requestConfig with fetch adapter and Cline client-type header", async () => {
		const provider = await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
			options: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://auth.example",
			},
		});

		const model = provider.operations.language(
			"anthropic--claude-4.6-sonnet",
		) as {
			config?: {
				requestConfig?: {
					adapter?: string;
					headers?: Record<string, string>;
					fetch?: unknown;
					maxBodyLength?: number;
					maxContentLength?: number;
				};
			};
		};

		expect(model.config?.requestConfig?.adapter).toBe("fetch");
		expect(model.config?.requestConfig?.headers?.["ai-client-type"]).toBe(
			"Cline",
		);
		expect(model.config?.requestConfig?.maxBodyLength).toBe(
			Number.POSITIVE_INFINITY,
		);
		expect(model.config?.requestConfig?.maxContentLength).toBe(
			Number.POSITIVE_INFINITY,
		);
		expect(model.config?.requestConfig?.fetch).toBeUndefined();
	});

	it("forwards custom fetch function via requestConfig.fetch", async () => {
		const customFetch = globalThis.fetch as unknown as typeof fetch;

		const provider = await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
			fetch: customFetch,
			options: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://auth.example",
			},
		});

		const model = provider.operations.language(
			"anthropic--claude-4.6-sonnet",
		) as {
			config?: {
				requestConfig?: { fetch?: unknown };
			};
		};

		expect(model.config?.requestConfig?.fetch).toBe(customFetch);
	});

	it("fails fast for partial explicit SAP configuration", async () => {
		await expect(
			createSapAiCoreProviderModule({
				providerId: "sapaicore",
				options: {
					clientId: "sap-client",
					clientSecret: "sap-secret",
					tokenUrl: "https://auth.example",
				},
			}),
		).rejects.toThrow(/baseUrl/);
	});
});

describe("createClaudeCodeProviderModule", () => {
	const originalPath = process.env.PATH;
	const temporaryDirectories = new Set<string>();

	beforeEach(() => {
		claudeCodeMock.createClaudeCode.mockClear();
		claudeCodeMock.resolveBundledPackage.mockReset();
		claudeCodeMock.resolveBundledPackage.mockImplementation(() => {
			throw new Error("optional package not installed");
		});
	});

	afterEach(() => {
		process.env.PATH = originalPath;
		for (const directory of temporaryDirectories) {
			rmSync(directory, { recursive: true, force: true });
		}
		temporaryDirectories.clear();
	});

	function settingsFromLastCall(): Record<string, unknown> {
		const [options] = claudeCodeMock.createClaudeCode.mock.calls.at(-1) as [
			{ defaultSettings: Record<string, unknown> },
		];
		return options.defaultSettings;
	}

	function createExecutable(prefix: string, name: string): string {
		const directory = mkdtempSync(join(tmpdir(), prefix));
		temporaryDirectories.add(directory);
		const executable = join(directory, name);
		writeFileSync(executable, "#!/bin/sh\n");
		chmodSync(executable, 0o755);
		return executable;
	}

	function createBundledExecutable(): string {
		const name = process.platform === "win32" ? "claude.exe" : "claude";
		const executable = createExecutable("cline-claude-code-bundled-", name);
		const manifest = join(dirname(executable), "package.json");
		writeFileSync(manifest, "{}");
		claudeCodeMock.resolveBundledPackage.mockReturnValue(manifest);
		return executable;
	}

	function createPathExecutable(): string {
		const name = process.platform === "win32" ? "claude.exe" : "claude";
		const executable = createExecutable("cline-claude-code-path-", name);
		process.env.PATH = dirname(executable);
		return executable;
	}

	it("prefers a configured executable over the bundled binary and PATH", async () => {
		createBundledExecutable();
		createPathExecutable();

		await createClaudeCodeProviderModule({
			providerId: "claude-code",
			options: {
				cwd: tmpdir(),
				defaultSettings: { pathToClaudeCodeExecutable: process.execPath },
			},
		});

		expect(settingsFromLastCall()).toMatchObject({
			pathToClaudeCodeExecutable: process.execPath,
			cwd: tmpdir(),
		});
		expect(claudeCodeMock.resolveBundledPackage).not.toHaveBeenCalled();
	});

	it("prefers the bundled executable over PATH when none is configured", async () => {
		const bundledExecutable = createBundledExecutable();
		createPathExecutable();

		await createClaudeCodeProviderModule({
			providerId: "claude-code",
			options: { cwd: tmpdir() },
		});

		expect(settingsFromLastCall()).toMatchObject({
			pathToClaudeCodeExecutable: bundledExecutable,
		});
	});

	it("falls back to PATH when no configured or bundled executable exists", async () => {
		const pathExecutable = createPathExecutable();

		await createClaudeCodeProviderModule({
			providerId: "claude-code",
			options: { cwd: tmpdir() },
		});

		expect(settingsFromLastCall()).toMatchObject({
			pathToClaudeCodeExecutable: pathExecutable,
		});
	});

	it("resolves a bare command name through PATH and pins the result", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-claude-code-path-"));
		const name = "cline-test-claude";
		const resolved = join(dir, name);
		writeFileSync(resolved, "#!/bin/sh\n");
		chmodSync(resolved, 0o755);
		const originalPath = process.env.PATH;
		process.env.PATH = dir;
		try {
			await createClaudeCodeProviderModule({
				providerId: "claude-code",
				options: { defaultSettings: { pathToClaudeCodeExecutable: name } },
			});
		} finally {
			process.env.PATH = originalPath;
			rmSync(dir, { recursive: true, force: true });
		}

		expect(settingsFromLastCall()).toMatchObject({
			pathToClaudeCodeExecutable: resolved,
		});
	});

	it("fails fast when a bare command name is not on PATH", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-claude-code-path-"));
		const originalPath = process.env.PATH;
		process.env.PATH = dir;
		try {
			await expect(
				createClaudeCodeProviderModule({
					providerId: "claude-code",
					options: {
						defaultSettings: {
							pathToClaudeCodeExecutable: "cline-test-claude-absent",
						},
					},
				}),
			).rejects.toThrow(
				"Claude Code CLI Path was not found on PATH: cline-test-claude-absent",
			);
		} finally {
			process.env.PATH = originalPath;
			rmSync(dir, { recursive: true, force: true });
		}
		expect(claudeCodeMock.createClaudeCode).not.toHaveBeenCalled();
	});

	// accessSync X_OK degrades to a plain existence check on Windows, so the
	// executable bit is only enforceable on POSIX.
	it.skipIf(process.platform === "win32")(
		"fails fast when the configured executable is not executable",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "cline-claude-code-path-"));
			const plain = join(dir, "not-executable");
			writeFileSync(plain, "#!/bin/sh\n");
			chmodSync(plain, 0o644);
			try {
				await expect(
					createClaudeCodeProviderModule({
						providerId: "claude-code",
						options: {
							defaultSettings: { pathToClaudeCodeExecutable: plain },
						},
					}),
				).rejects.toThrow(`Claude Code CLI Path is not executable: ${plain}`);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
			expect(claudeCodeMock.createClaudeCode).not.toHaveBeenCalled();
		},
	);

	it("fails fast when the configured executable does not exist", async () => {
		const missing = join(tmpdir(), "cline-claude-code-does-not-exist");

		await expect(
			createClaudeCodeProviderModule({
				providerId: "claude-code",
				options: {
					defaultSettings: { pathToClaudeCodeExecutable: missing },
				},
			}),
		).rejects.toThrow(`Claude Code CLI Path does not exist: ${missing}`);
		expect(claudeCodeMock.createClaudeCode).not.toHaveBeenCalled();
	});

	it("fails fast when the configured executable is not a file", async () => {
		await expect(
			createClaudeCodeProviderModule({
				providerId: "claude-code",
				options: {
					defaultSettings: { pathToClaudeCodeExecutable: tmpdir() },
				},
			}),
		).rejects.toThrow(/Claude Code CLI Path is not a file/);
		expect(claudeCodeMock.createClaudeCode).not.toHaveBeenCalled();
	});

	it("fails fast when a blank executable path reaches the provider", async () => {
		// Hosts are expected to omit the key entirely for a cleared setting; a
		// blank string would otherwise suppress fallback resolution silently.
		await expect(
			createClaudeCodeProviderModule({
				providerId: "claude-code",
				options: { defaultSettings: { pathToClaudeCodeExecutable: "  " } },
			}),
		).rejects.toThrow(/Claude Code CLI Path is not a valid path/);
	});
});
