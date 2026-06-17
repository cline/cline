import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	hasMcpSettingsFile,
	listMcpServerOAuthStatuses,
	loadMcpSettingsFile,
	registerMcpServersFromSettingsFile,
	resolveMcpServerRegistrations,
	setMcpServerDisabled,
	updateMcpServerOAuthState,
	updateMcpSettingsFile,
	updateMcpSettingsFileSync,
	McpSettingsMutatorPurityError,
} from "./config-loader";

describe("mcp config loader", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
		tempRoots.length = 0;
	});

	it("loads and validates mcp server registrations from JSON", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							transport: {
								type: "stdio",
								command: "npx",
								args: ["-y", "@modelcontextprotocol/server-filesystem"],
							},
						},
						search: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.example.com",
							},
							disabled: true,
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		expect(hasMcpSettingsFile({ filePath })).toBe(true);
		expect(
			loadMcpSettingsFile({ filePath }).mcpServers.docs.transport.type,
		).toBe("stdio");

		const registrations = resolveMcpServerRegistrations({ filePath });
		expect(registrations).toEqual([
			{
				name: "docs",
				transport: {
					type: "stdio",
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-filesystem"],
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
			{
				name: "search",
				transport: {
					type: "streamableHttp",
					url: "https://mcp.example.com",
				},
				disabled: true,
				metadata: undefined,
				oauth: undefined,
			},
		]);
	});

	it("registers loaded servers with an mcp manager", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							transport: {
								type: "stdio",
								command: "node",
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registered: Array<{ name: string }> = [];
		const manager = {
			registerServer: async (registration: { name: string }) => {
				registered.push(registration);
			},
		};

		await registerMcpServersFromSettingsFile(manager, { filePath });
		expect(registered).toEqual([
			{
				name: "docs",
				transport: {
					type: "stdio",
					command: "node",
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
		]);
	});

	it("throws a clear error for invalid config", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						broken: {
							transport: {
								type: "stdio",
								command: "",
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		expect(() => resolveMcpServerRegistrations({ filePath })).toThrow(
			"Invalid MCP settings",
		);
	});

	it("accepts legacy flat stdio format", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							command: "node",
							args: ["server.js"],
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registrations = resolveMcpServerRegistrations({ filePath });
		expect(registrations).toEqual([
			{
				name: "docs",
				transport: {
					type: "stdio",
					command: "node",
					args: ["server.js"],
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
		]);
	});

	it("accepts legacy flat url format and preserves explicit transportType", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						legacySse: {
							url: "https://sse.example.com",
						},
						legacyHttp: {
							url: "https://http.example.com",
							transportType: "http",
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registrations = resolveMcpServerRegistrations({ filePath });
		expect(registrations).toEqual([
			{
				name: "legacySse",
				transport: {
					type: "sse",
					url: "https://sse.example.com",
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
			{
				name: "legacyHttp",
				transport: {
					type: "streamableHttp",
					url: "https://http.example.com",
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
		]);
	});

	it("updates disabled state while preserving legacy server shape and top-level settings", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					otherSetting: true,
					mcpServers: {
						docs: {
							command: "node",
							args: ["server.js"],
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		setMcpServerDisabled({ filePath, name: "docs", disabled: true });
		const disabled = JSON.parse(await readFile(filePath, "utf8")) as {
			otherSetting?: boolean;
			mcpServers?: Record<
				string,
				{ command?: string; args?: string[]; disabled?: boolean }
			>;
		};
		expect(disabled.otherSetting).toBe(true);
		expect(disabled.mcpServers?.docs).toEqual({
			command: "node",
			args: ["server.js"],
			disabled: true,
		});

		setMcpServerDisabled({ filePath, name: "docs", disabled: false });
		const enabled = JSON.parse(await readFile(filePath, "utf8")) as {
			mcpServers?: Record<string, { disabled?: boolean }>;
		};
		expect(enabled.mcpServers?.docs?.disabled).toBeUndefined();
	});

	it("loads and updates sdk-managed oauth state in server entries", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						linear: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.linear.app/mcp",
							},
							oauth: {
								tokens: {
									access_token: "old-token",
									token_type: "Bearer",
								},
								lastAuthenticatedAt: 123,
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registrations = resolveMcpServerRegistrations({ filePath });
		expect(registrations[0]?.oauth?.tokens?.access_token).toBe("old-token");
		expect(listMcpServerOAuthStatuses({ filePath })).toEqual([
			{
				serverName: "linear",
				oauthSupported: true,
				oauthConfigured: true,
				lastError: undefined,
				lastAuthenticatedAt: 123,
			},
		]);

		updateMcpServerOAuthState(
			"linear",
			(current) => ({
				...current,
				tokens: {
					access_token: "new-token",
					token_type: "Bearer",
				},
				lastError: undefined,
			}),
			{ filePath },
		);

		const written = JSON.parse(await readFile(filePath, "utf8")) as {
			mcpServers: {
				linear: {
					oauth?: {
						tokens?: Record<string, unknown>;
						lastAuthenticatedAt?: number;
					};
				};
			};
		};
		expect(written.mcpServers.linear.oauth?.tokens?.access_token).toBe(
			"new-token",
		);
		expect(written.mcpServers.linear.oauth?.lastAuthenticatedAt).toBe(123);
	});

	it("rejects inherited server names when updating oauth state", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {},
				},
				null,
				2,
			),
			"utf8",
		);

		const objectPrototype = Object.prototype as { oauth?: unknown };
		const originalOauth = objectPrototype.oauth;
		try {
			expect(() =>
				updateMcpServerOAuthState(
					"__proto__",
					() => ({
						tokens: {
							access_token: "bad-token",
						},
					}),
					{ filePath },
				),
			).toThrow("Unknown MCP server: __proto__");
			expect(objectPrototype.oauth).toBe(originalOauth);
		} finally {
			if (originalOauth === undefined) {
				delete objectPrototype.oauth;
			} else {
				objectPrototype.oauth = originalOauth;
			}
		}
	});

	it("serializes concurrent oauth updates so neither write is lost", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						linear: { transport: { type: "streamableHttp", url: "https://linear.example.com" } },
						github: { transport: { type: "streamableHttp", url: "https://github.example.com" } },
					},
				},
				null,
				2,
			),
			"utf8",
		);

		updateMcpServerOAuthState("linear", () => ({ tokens: { access_token: "linear-token" } }), {
			filePath,
		});
		updateMcpServerOAuthState("github", () => ({ tokens: { access_token: "github-token" } }), {
			filePath,
		});

		const written = JSON.parse(await readFile(filePath, "utf8"));
		expect(written.mcpServers.linear.oauth?.tokens?.access_token).toBe("linear-token");
		expect(written.mcpServers.github.oauth?.tokens?.access_token).toBe("github-token");
		// Lockfile is released after each critical section.
		expect(existsSync(`${filePath}.lock`)).toBe(false);
	});

	it("reclaims a stale lock directory older than the hang timeout", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(filePath, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");

		// Simulate a crashed writer that left a lock directory behind, backdated well
		// past the 10s stale threshold.
		const lockPath = `${filePath}.lock`;
		mkdirSync(lockPath);
		writeFileSync(join(lockPath, "owner.dead"), "dead-owner");
		const stale = new Date(Date.now() - 60_000);
		const { utimesSync } = await import("node:fs");
		utimesSync(lockPath, stale, stale);

		let ran = false;
		updateMcpSettingsFileSync(filePath, () => {
			ran = true;
		});

		expect(ran).toBe(true);
		// The stale lock was reclaimed and our own lock released afterward.
		expect(existsSync(lockPath)).toBe(false);
		expect(statSync(filePath).isFile()).toBe(true);
	});

	it("does not delete another owner's replacement lock directory on release", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(filePath, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");

		const lockPath = `${filePath}.lock`;
		updateMcpSettingsFileSync(filePath, () => {
			// Simulate another process reclaiming our lock directory before our
			// finally release runs. Release must remove only our owner marker and then
			// rmdir the directory; a populated replacement must survive.
			const [owner] = readdirSync(lockPath);
			unlinkSync(join(lockPath, owner));
			rmdirSync(lockPath);
			const replacement = `${lockPath}.replacement`;
			mkdirSync(replacement);
			writeFileSync(join(replacement, "owner.replacement"), "replacement-owner", { flag: "wx" });
			renameSync(replacement, lockPath);
		});

		expect(readdirSync(lockPath)).toEqual(["owner.replacement"]);
	});

	it("rejects impure settings mutators whose output changes across calls", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(filePath, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");

		let count = 0;
		expect(() =>
			updateMcpSettingsFileSync(filePath, (settings) => {
				count += 1;
				settings.mcpServers = { generated: { counter: count } };
			}),
		).toThrow(McpSettingsMutatorPurityError);
	});
});

describe("updateMcpSettingsFile (async acquisition)", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((directory) => rm(directory, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	async function makeSettingsFile(): Promise<string> {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-async-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(filePath, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");
		return filePath;
	}

	it("runs the mutator and releases the lock on the uncontended path", async () => {
		const filePath = await makeSettingsFile();
		let mutatorRan = false;

		const result = await updateMcpSettingsFile(filePath, (settings) => {
			mutatorRan = true;
			settings.mcpServers = { alpha: { transport: { type: "stdio", command: "node" } } };
			return "ok";
		});

		// The mutator (a synchronous, pure function) ran, the write landed, and the
		// lock directory is gone — i.e. the lock is never left held after resolution.
		// (That the lock is never held *across* an await is covered by the contended
		// test below, which asserts serialization without any Atomics.wait.)
		expect(mutatorRan).toBe(true);
		expect(result).toBe("ok");
		expect(existsSync(`${filePath}.lock`)).toBe(false);
		const written = JSON.parse(await readFile(filePath, "utf8"));
		expect(written.mcpServers.alpha.transport.command).toBe("node");
	});

	it("serializes contended async updates without losing a write and never blocks the event loop", async () => {
		const filePath = await makeSettingsFile();
		const waitSpy = vi.spyOn(Atomics, "wait");
		try {
			// Pre-place a held lock owned by a fictional live process so the first
			// real update has to wait (and therefore exercise the await-delay path).
			const lockDir = `${filePath}.lock`;
			mkdirSync(lockDir);
			writeFileSync(join(lockDir, "owner.holder"), "holder");

			const linear = updateMcpSettingsFile(
				filePath,
				(settings) => {
					const servers = settings.mcpServers as Record<string, Record<string, unknown>>;
					servers.linear.oauth = { tokens: { access_token: "linear-token" } };
				},
				{ timeoutMs: 5_000 },
			).catch(() => undefined);
			const github = updateMcpSettingsFile(
				filePath,
				(settings) => {
					const servers = settings.mcpServers as Record<string, Record<string, unknown>>;
					servers.github.oauth = { tokens: { access_token: "github-token" } };
				},
				{ timeoutMs: 5_000 },
			).catch(() => undefined);

			// Seed the two servers while the contender(s) are parked on the lock,
			// then release the held lock so the waiters can proceed.
			await writeFile(
				filePath,
				JSON.stringify(
					{
						mcpServers: {
							linear: { transport: { type: "streamableHttp", url: "https://linear.example.com" } },
							github: { transport: { type: "streamableHttp", url: "https://github.example.com" } },
						},
					},
					null,
					2,
				),
				"utf8",
			);
			unlinkSync(join(lockDir, "owner.holder"));
			rmdirSync(lockDir);

			await Promise.all([linear, github]);

			const written = JSON.parse(await readFile(filePath, "utf8"));
			expect(written.mcpServers.linear.oauth?.tokens?.access_token).toBe("linear-token");
			expect(written.mcpServers.github.oauth?.tokens?.access_token).toBe("github-token");
			// Lock released after each critical section.
			expect(existsSync(lockDir)).toBe(false);
			// The whole point of the async path: it must never freeze the loop.
			expect(waitSpy).not.toHaveBeenCalled();
		} finally {
			waitSpy.mockRestore();
		}
	});

	it("creates a missing settings file inside the lock", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-async-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");

		await updateMcpSettingsFile(filePath, (settings) => {
			const servers = settings.mcpServers as Record<string, unknown>;
			servers.docs = { transport: { type: "stdio", command: "node" } };
		});

		const written = JSON.parse(await readFile(filePath, "utf8"));
		expect(Object.keys(written.mcpServers)).toEqual(["docs"]);
	});

	it("reclaims a stale lock directory on the async path", async () => {
		const filePath = await makeSettingsFile();
		const lockDir = `${filePath}.lock`;
		mkdirSync(lockDir);
		writeFileSync(join(lockDir, "owner.dead"), "dead-owner");
		const stale = new Date(Date.now() - 60_000);
		const { utimesSync } = await import("node:fs");
		utimesSync(lockDir, stale, stale);

		let ran = false;
		await updateMcpSettingsFile(filePath, () => {
			ran = true;
		});

		expect(ran).toBe(true);
		expect(existsSync(lockDir)).toBe(false);
	});

	it("fails fast on a reentrant settings update instead of deadlocking the loop", async () => {
		const filePath = await makeSettingsFile();

		await expect(
			updateMcpSettingsFile(filePath, () => {
				// A nested write on the same file would deadlock against the lock we
				// already hold; the shared reentrancy guard must reject it instead.
				updateMcpSettingsFileSync(filePath, () => {});
			}),
		).rejects.toThrow(/Reentrant MCP settings update/);

		// Guard ran inside the mutator, but the outer lock is still cleaned up.
		expect(existsSync(`${filePath}.lock`)).toBe(false);
	});
});
