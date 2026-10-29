import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunCommandExecutionController } from "../../extensions/tools";
import { DefaultRuntimeBuilder } from "../../runtime/orchestration/runtime-builder";
import { prepareLocalRuntimeBootstrap } from "../../services/local-runtime-bootstrap";
import type { HubTransportContext } from "../server/handlers/context";
import { handleSessionCreate } from "../server/handlers/session-handlers";

const wire = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../client", () => ({
	NodeHubClient: class {
		command = wire.command;
		subscribe = () => () => {};
		dispose = async () => {};
		close = async () => {};
	},
	isHubCommandTimeoutError: () => false,
	restartLocalHubIfIdleAfterStartupTimeout: async () => undefined,
}));

// An in-process command transport exercises the real client serialization,
// Hub handler, bootstrap, runtime builder and shell child without a TCP port,
// model request, user configuration or the machine's shared Hub.
describe("Hub session shell environment", () => {
	const roots: string[] = [];
	afterEach(() => {
		vi.unstubAllEnvs();
		setHomeDir(process.env.HOME ?? "~");
		setClineDir(
			process.env.CLINE_DIR ?? join(process.env.HOME ?? "~", ".cline"),
		);
		wire.command.mockReset();
		for (const root of roots.splice(0))
			rmSync(root, { recursive: true, force: true });
	});
	it("isolates two fresh clients concurrently and never serializes their snapshot into session state", async () => {
		const root = mkdtempSync(join(tmpdir(), "hub-shell-env-"));
		roots.push(root);
		setHomeDir(root);
		setClineDir(join(root, ".cline"));
		vi.stubEnv("CLINE_GLOBAL_SETTINGS_PATH", join(root, "settings.json"));
		vi.stubEnv("CLINE_TEST_DAEMON_SECRET", "daemon-only-synthetic");
		vi.stubEnv("CLINE_TEST_STALE_PANE", "old-pane");
		const serverEnvironment = { ...process.env };
		const controller = new RunCommandExecutionController();
		const runtimes = new Map<
			string,
			Awaited<ReturnType<DefaultRuntimeBuilder["build"]>>
		>();
		const persisted: unknown[] = [];
		const published: unknown[] = [];
		const ctx = {
			sessionState: new Map(),
			sessionHost: {
				startSession: async (
					input: Parameters<typeof prepareLocalRuntimeBootstrap>[0]["input"],
				) => {
					const sessionId = input.config.sessionId;
					if (!sessionId) throw new Error("Expected session id");
					const bootstrap = await prepareLocalRuntimeBootstrap({
						input: input as never,
						localRuntime: input.localRuntime,
						sessionId,
						providerSettingsManager: {
							getProviderSettings: () => undefined,
						} as never,
						onPluginEvent: () => {},
						onTeamEvent: () => {},
						// Fixture sessions set enableSpawnAgent: false; fail fast if a
						// spawn tool is ever requested so the fixture cannot drift.
						createSpawnTool: () => {
							throw new Error("Unexpected spawn tool in shell-only fixture");
						},
						readSessionMetadata: async () => undefined,
						writeSessionMetadata: async (value) => {
							persisted.push(value);
						},
					});
					persisted.push(bootstrap.config, input.config, input.sessionMetadata);
					runtimes.set(
						sessionId,
						await new DefaultRuntimeBuilder().build({
							...bootstrap.runtimeBuilderInput,
							runCommandExecutionController: controller,
						}),
					);
					return { sessionId };
				},
				getSession: async () => undefined,
			},
			requestCapability: vi.fn(),
			publish: (event: unknown) => published.push(event),
		} as unknown as HubTransportContext;
		wire.command.mockImplementation(async (command, payload) => {
			expect(command).toBe("session.create");
			const reply = await handleSessionCreate(
				ctx,
				{
					version: "v1",
					command,
					clientId: payload.sessionConfig.sessionId,
					requestId: payload.sessionConfig.sessionId,
					payload: JSON.parse(JSON.stringify(payload)),
				},
				async () => ({ approved: true }),
			);
			return {
				...reply,
				payload: {
					...reply.payload,
					session: {
						sessionId: payload.sessionConfig.sessionId,
						status: "running",
						createdAt: Date.now(),
						workspaceRoot: root,
						cwd: root,
					},
				},
			};
		});
		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const config = (sessionId: string) => ({
			sessionId,
			cwd: root,
			workspaceRoot: root,
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			systemPrompt: "test",
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		});
		// A replaced environment on Windows still needs the system variables
		// the child runtime requires to start; they are not asserted on.
		const windowsBase: Record<string, string> =
			process.platform === "win32"
				? Object.fromEntries(
						[
							"SystemRoot",
							"SYSTEMROOT",
							"windir",
							"PATH",
							"Path",
							"PATHEXT",
							"COMSPEC",
							"TEMP",
							"TMP",
						].flatMap((key) => {
							const value = process.env[key];
							return value === undefined ? [] : [[key, value]];
						}),
					)
				: {};
		const clientA = {
			...windowsBase,
			CLINE_TEST_CANARY: "fresh-A",
			CLINE_TEST_ONLY_A: "A",
			EMPTY: "",
		};
		const clientB = {
			...windowsBase,
			CLINE_TEST_CANARY: "fresh-B",
			CLINE_TEST_ONLY_B: "B",
		};
		const a = new HubRuntimeHost({
			url: "ws://127.0.0.1/hub",
			captureShellEnvironment: () => clientA,
		});
		const b = new HubRuntimeHost({
			url: "ws://127.0.0.1/hub",
			captureShellEnvironment: () => clientB,
		});
		const legacy = new HubRuntimeHost({ url: "ws://127.0.0.1/hub" });
		const starts = await Promise.all([
			a.startSession({
				config: config("session-A"),
				localRuntime: { configExtensions: [] },
			}),
			b.startSession({
				config: config("session-B"),
				localRuntime: { configExtensions: [] },
			}),
			legacy.startSession({
				config: config("session-legacy"),
				localRuntime: { configExtensions: [] },
			}),
		]);
		clientA.CLINE_TEST_CANARY = "changed-after-create";
		const keys = [
			"CLINE_TEST_CANARY",
			"CLINE_TEST_ONLY_A",
			"CLINE_TEST_ONLY_B",
			"CLINE_TEST_STALE_PANE",
			"CLINE_TEST_DAEMON_SECRET",
			"EMPTY",
		];
		// An owned probe file passed by argv avoids native-argument quoting
		// differences (Windows PowerShell 5.1 drops embedded double quotes).
		const script = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(k=>[k,process.env[k]??null]))))`;
		const probePath = join(root, "probe.js");
		writeFileSync(probePath, script);
		const run = async (id: string, structured: boolean) => {
			const tool = runtimes
				.get(id)
				?.tools.find((tool) => tool.name === "run_commands");
			if (!tool) throw new Error("Expected built-in shell tool");
			const command = structured
				? { command: process.execPath, args: [probePath] }
				: `"${process.execPath}" -e '${script}'`;
			return JSON.stringify(
				await tool.execute(
					{ commands: [command] },
					{
						sessionId: id,
						agentId: id,
						conversationId: id,
						iteration: 0,
					},
				),
			);
		};
		try {
			const [outA, outB] = await Promise.all([
				run("session-A", true),
				run("session-B", true),
			]);
			expect(outA).toContain("fresh-A");
			expect(outA).not.toContain("fresh-B");
			expect(outB).toContain("fresh-B");
			expect(outB).not.toContain("fresh-A");
			// The shell-string path stays POSIX-only: createWindowsExecutor tests
			// cover PowerShell command-string handling.
			const outputs = [outA, outB];
			if (process.platform !== "win32")
				outputs.push(await run("session-A", false));
			for (const output of outputs) {
				expect(output).not.toContain("daemon-only-synthetic");
				expect(output).not.toContain("old-pane");
				expect(output).not.toContain("changed-after-create");
			}
			expect(outA).toContain('CLINE_TEST_ONLY_B\\":null');
			expect(outB).toContain('CLINE_TEST_ONLY_A\\":null');
			expect(await run("session-legacy", true)).toContain(
				"daemon-only-synthetic",
			);
			// Compare as a boolean so a failure never prints the real server environment.
			expect(
				Object.keys(process.env).length ===
					Object.keys(serverEnvironment).length &&
					Object.entries(serverEnvironment).every(
						([key, value]) => process.env[key] === value,
					),
			).toBe(true);
			expect(JSON.stringify([persisted, published, starts])).not.toContain(
				"fresh-A",
			);
			expect(JSON.stringify([persisted, published, starts])).not.toContain(
				"fresh-B",
			);
			expect(JSON.stringify([persisted, published, starts])).not.toContain(
				"shellEnvironment",
			);
		} finally {
			await Promise.all(
				[...runtimes.values()].map((runtime) =>
					runtime.shutdown("test complete"),
				),
			);
			await Promise.all([a.dispose(), b.dispose(), legacy.dispose()]);
		}
	});
});
