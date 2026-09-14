import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type RemoteCommandResult,
	type RemoteEnvironmentDependencies,
	RemoteEnvironmentService,
	type RemoteEnvironmentServiceOptions,
	type RemoteTunnelProcess,
	runRemoteProcess,
} from "./remote-environments";

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return { ...actual, spawn: vi.fn(actual.spawn) };
});

class FakeTunnel extends EventEmitter implements RemoteTunnelProcess {
	public readonly pid = 4242;
	public exitCode: number | null = null;
	public killed = false;

	public kill(): boolean {
		this.killed = true;
		return true;
	}
}

interface Invocation {
	executable: string;
	args: string[];
	options: { timeoutMs: number; inputFile?: string };
}

function success(stdout = "", stderr = ""): RemoteCommandResult {
	return { stdout, stderr, exitCode: 0 };
}

function inspection(
	platform: string,
	arch: string,
	home: string,
	prefix = "",
): RemoteCommandResult {
	return success(
		`${prefix}\0CLINE_REMOTE_INSPECT_V1\0${platform}\0${arch}\0${home}\0`,
	);
}

describe("RemoteEnvironmentService", () => {
	let testDirectory: string;
	let profilesPath: string;

	beforeEach(async () => {
		testDirectory = await mkdtemp(join(tmpdir(), "cline-remote-environments-"));
		profilesPath = join(
			testDirectory,
			"data",
			"settings",
			"remote-environments.json",
		);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(testDirectory, { recursive: true, force: true });
	});

	function createService(
		overrides: Partial<RemoteEnvironmentDependencies> = {},
		options: Omit<
			RemoteEnvironmentServiceOptions,
			"profilesPath" | "dependencies"
		> = {},
	): RemoteEnvironmentService {
		let id = 0;
		return new RemoteEnvironmentService({
			...options,
			profilesPath,
			dependencies: {
				now: () => new Date("2026-08-06T12:00:00.000Z"),
				randomId: () => `test-id-${++id}`,
				requestHubShutdown: async () => true,
				...overrides,
			},
		});
	}

	it("waits for stream close and captures diagnostics after process exit", async () => {
		const child = Object.assign(new EventEmitter(), {
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			stdin: null,
		});
		vi.mocked(childProcess.spawn).mockReturnValueOnce(
			child as unknown as childProcess.ChildProcess,
		);
		const result = runRemoteProcess("ssh", [], { timeoutMs: 2000 });
		child.stderr.write("gcloud NumPy warning\n");
		child.emit("exit", 23, null);
		child.stderr.write("remote helper failed\n");
		child.emit("close", 23, null);
		await expect(result).resolves.toEqual({
			exitCode: 23,
			stdout: "",
			stderr: "gcloud NumPy warning\nremote helper failed\n",
		});
	});

	it("captures delayed stderr from a real subprocess", async () => {
		const result = await runRemoteProcess(
			process.execPath,
			[
				"-e",
				'process.stderr.write("early\\n"); setTimeout(() => { process.stderr.write("late\\n", () => { process.exitCode = 23; }); }, 40);',
			],
			{ timeoutMs: 5000 },
		);
		expect(result).toEqual({
			exitCode: 23,
			stdout: "",
			stderr: "early\nlate\n",
		});
	});

	// Inherited descendant pipe handles in this fixture require POSIX.
	it.skipIf(process.platform === "win32")(
		"drains inherited ProxyCommand output after SSH exits",
		async () => {
			const lateDiagnosticProgram =
				'const { spawn } = require("node:child_process");' +
				'spawn(process.execPath, ["-e", "setTimeout(() => process.stderr.write(\\"remote helper failed\\\\n\\"), 40)"], { stdio: ["ignore", "ignore", 2] });' +
				'process.stderr.write("gcloud NumPy warning\\n");' +
				"process.exit(23);";

			const result = await runRemoteProcess(
				process.execPath,
				["-e", lateDiagnosticProgram],
				{ timeoutMs: 2_000 },
			);

			expect(result).toMatchObject({ exitCode: 23, stdout: "" });
			expect(result.stderr).toContain("gcloud NumPy warning");
			expect(result.stderr).toContain("remote helper failed");
		},
	);

	it.each([
		"stdout",
		"stderr",
	])("bounds captured %s and terminates a noisy process", async (stream) => {
		await expect(
			runRemoteProcess(
				process.execPath,
				[
					"-e",
					`process.on('SIGTERM', () => {}); setInterval(() => process.${stream}.write('x'.repeat(8192)), 1)`,
				],
				{ timeoutMs: 5000, maxOutputBytes: 16384 },
			),
		).rejects.toThrow("output exceeded 16384 bytes");
	});
	it("waits for SIGKILL when a timed-out process ignores SIGTERM", async () => {
		const pidFile = join(testDirectory, "process.pid");
		await expect(
			runRemoteProcess(
				process.execPath,
				[
					"-e",
					`require('fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`,
					pidFile,
				],
				{ timeoutMs: 500 },
			),
		).rejects.toThrow("timed out");
		const pid = Number(await readFile(pidFile, "utf8"));
		expect(() => process.kill(pid, 0)).toThrow();
	});
	it("cleans up when the upload input cannot be opened", async () => {
		await expect(
			runRemoteProcess(process.execPath, ["-e", "process.stdin.resume()"], {
				timeoutMs: 5000,
				inputFile: join(testDirectory, "missing"),
			}),
		).rejects.toThrow("ENOENT");
	});

	it.each([
		"connect",
		"delete",
	])("recovers lost-Hub cleanup with a deleted helper before %s", async (action) => {
		const commands: string[] = [];
		const tunnels: FakeTunnel[] = [];
		let offline = false;
		let requiredIdentity: string | undefined;
		let helperMissing = false;
		let uploads = 0;
		const dependencies: Partial<RemoteEnvironmentDependencies> = {
			runProcess: async (_executable, args, options) => {
				const command = args.at(-1) ?? "";
				commands.push(command);
				if (offline) throw new Error("Network unavailable");
				if (options.inputFile) {
					uploads += 1;
					helperMissing = false;
				}
				if (helperMissing && command.includes("'test' '-x'"))
					return { stdout: "", stderr: "", exitCode: 1 };
				if (helperMissing && command.includes("--remote-hub-stop"))
					throw new Error("Helper missing");
				if (requiredIdentity && !args.includes(requiredIdentity)) {
					throw new Error("Obsolete SSH identity");
				}
				if (command.includes("uname -s"))
					return inspection("Linux", "x86_64", "/home/dev");
				if (command.includes("--remote-hub-ensure"))
					return success(
						'{"url":"ws://127.0.0.1:25463/hub","authToken":"token"}',
					);
				return success();
			},
			resolveHelperBinary: async () => "/helper",
			fileReadable: async () => true,
			hashFile: async () => "0123456789abcdef",
			reservePort: async () => 41000 + tunnels.length,
			spawnTunnel: () => {
				const tunnel = new FakeTunnel();
				tunnels.push(tunnel);
				return tunnel;
			},
			waitForTunnel: async () => undefined,
		};
		const service = createService(dependencies);
		const first = await service.upsert({ name: "First", host: "same-account" });
		const second = await service.upsert({
			name: "Second",
			host: "same-account",
		});
		await service.connect(first.id);
		await service.connect(second.id);
		const ensures = commands.filter((command) =>
			command.includes("--remote-hub-ensure"),
		);
		expect(ensures).toHaveLength(2);
		expect(ensures[0]).not.toBe(ensures[1]);
		offline = true;
		tunnels[0].emit("exit", 255, null);
		await expect(service.dispose()).rejects.toThrow("Network unavailable");
		expect(await readdir(`${profilesPath}.cleanup`)).toHaveLength(1);
		offline = false;
		const restarted = createService(dependencies);
		requiredIdentity = "/keys/rotated";
		helperMissing = true;
		await restarted.upsert({ ...first, identityFile: requiredIdentity });
		if (action === "connect") await restarted.connect(first.id);
		else expect(await restarted.delete(first.id)).toBe(true);
		expect(uploads).toBe(1);
		await restarted.dispose();
		expect(await readdir(`${profilesPath}.cleanup`)).toEqual([]);
		const stop = commands
			.filter((command) => command.includes("--remote-hub-stop"))
			.at(-1);
		expect(stop?.split("'--discovery-path' ")[1]).toBe(
			ensures[0]?.split("'--discovery-path' ")[1],
		);
	});

	it("persists profiles atomically with private permissions and updates in place", async () => {
		const service = createService();
		const created = await service.upsert({
			name: " Build box ",
			host: "build.example.com",
			user: "alice",
			port: 2222,
			identityFile: "~/.ssh/build_ed25519",
		});

		expect(created).toMatchObject({
			id: "test-id-1",
			name: "Build box",
			host: "build.example.com",
			createdAt: "2026-08-06T12:00:00.000Z",
			updatedAt: "2026-08-06T12:00:00.000Z",
		});
		// Windows exposes synthetic mode bits; file access is governed by ACLs.
		if (process.platform !== "win32") {
			expect((await stat(profilesPath)).mode & 0o777).toBe(0o600);
		}

		const stored = JSON.parse(await readFile(profilesPath, "utf8"));
		expect(stored).toEqual({ version: 1, profiles: [created] });
		const updated = await service.upsert({
			...created,
			name: "Build box renamed",
		});
		expect(updated.id).toBe(created.id);
		expect(updated.createdAt).toBe(created.createdAt);
		expect(await service.list()).toEqual([updated]);
		await expect(
			service.upsert({ ...updated, host: "other.example.com" }),
		).rejects.toThrow("Create a new remote environment instead");
		expect(await service.list()).toEqual([updated]);

		const reloaded = createService();
		expect(await reloaded.list()).toEqual([updated]);
	});

	it("validates profile fields before persisting them", async () => {
		const service = createService();
		await expect(
			service.upsert({ name: "bad", host: "-oProxyCommand=bad" }),
		).rejects.toThrow("SSH host");
		await expect(
			service.upsert({ name: "bad", host: "host", port: 70_000 }),
		).rejects.toThrow("between 1 and 65535");
		await expect(service.list()).resolves.toEqual([]);
	});

	it("tests SSH connectivity with safe non-interactive OpenSSH options", async () => {
		const invocations: Invocation[] = [];
		const service = createService({
			runProcess: async (executable, args, options) => {
				invocations.push({ executable, args, options });
				return inspection("Linux", "x86_64", "/home/alice");
			},
		});
		const profile = await service.upsert({
			name: "Remote",
			host: "ssh-alias",
			user: "alice",
			port: 2202,
			identityFile: "/keys/remote key",
		});

		await expect(service.test(profile.id)).resolves.toMatchObject({
			profileId: profile.id,
			state: "available",
			remotePlatform: "linux",
			remoteArch: "x64",
			remoteHome: "/home/alice",
		});
		expect(invocations).toHaveLength(1);
		expect(invocations[0]?.executable).toBe("ssh");
		expect(invocations[0]?.args).toEqual(
			expect.arrayContaining([
				"-o",
				"BatchMode=yes",
				"ConnectTimeout=10",
				"StrictHostKeyChecking=yes",
				"-p",
				"2202",
				"-i",
				"/keys/remote key",
				"alice@ssh-alias",
			]),
		);
		expect(invocations[0]?.args.at(-1)).toContain("uname -s");
	});

	it("leaves the SSH port unset so an OpenSSH config alias can choose it", async () => {
		const invocations: Invocation[] = [];
		const service = createService({
			runProcess: async (executable, args, options) => {
				invocations.push({ executable, args, options });
				return inspection("Linux", "x86_64", "/home/alice");
			},
		});
		const profile = await service.upsert({
			name: "Configured host",
			host: "pi-from-ssh-config",
		});

		await service.test(profile.id);

		expect(invocations[0]?.args).not.toContain("-p");
		expect(invocations[0]?.args.at(-2)).toBe("pi-from-ssh-config");
	});

	it("parses framed inspection data after noisy SSH startup output", async () => {
		const service = createService({
			runProcess: async () => ({
				...inspection(
					"Linux",
					"aarch64",
					"/home/pi",
					"Welcome to the Pi server\n.bashrc says hello\n",
				),
				stderr: "gcloud: NumPy is not installed; tunnel may be slower.\n",
			}),
		});
		const profile = await service.upsert({ name: "Pi", host: "pi" });

		await expect(service.test(profile.id)).resolves.toMatchObject({
			state: "available",
			remotePlatform: "linux",
			remoteArch: "arm64",
			remoteHome: "/home/pi",
		});
	});

	it("bootstraps the exact helper and creates a loopback-only SSH tunnel", async () => {
		const invocations: Invocation[] = [];
		const tunnel = new FakeTunnel();
		const spawnTunnel = vi.fn(() => tunnel);
		const waitForTunnel = vi.fn(async () => undefined);
		const requestHubShutdown = vi.fn(async () => {
			expect(tunnel.killed).toBe(false);
			return true;
		});
		const service = createService({
			runProcess: async (executable, args, options) => {
				invocations.push({ executable, args, options });
				const command = args.at(-1) ?? "";
				if (command.includes("uname -s")) {
					return inspection("Linux", "aarch64", "/home/dev");
				}
				if (command.includes("'test' '-x'")) {
					return { stdout: "", stderr: "", exitCode: 1 };
				}
				if (command.includes("--remote-hub-ensure")) {
					return success(
						'{"url":"ws://127.0.0.1:25463/hub","authToken":"remote-secret"}\n',
					);
				}
				return success();
			},
			resolveHelperBinary: async ({ platform, arch }) => {
				expect({ platform, arch }).toEqual({
					platform: "linux",
					arch: "arm64",
				});
				return "/opt/cline/code-sidecar-linux-arm64";
			},
			fileReadable: async () => true,
			hashFile: async () => "abcdef0123456789fedcba9876543210",
			reservePort: async () => 43117,
			spawnTunnel,
			waitForTunnel,
			requestHubShutdown,
		});
		const profile = await service.upsert({
			name: "ARM builder",
			host: "arm-builder",
		});

		const [connection, concurrentConnection] = await Promise.all([
			service.connect(profile.id),
			service.connect(profile.id),
		]);
		expect(concurrentConnection).toEqual(connection);
		expect(spawnTunnel).toHaveBeenCalledTimes(1);
		expect(connection).toMatchObject({
			profile,
			profileId: profile.id,
			state: "connected",
			endpoint: "ws://127.0.0.1:43117/hub",
			authToken: "remote-secret",
			workspaceRoot: "/home/dev",
			homeDir: "/home/dev",
			platform: "linux",
			arch: "arm64",
			remoteHubUrl: "ws://127.0.0.1:25463/hub",
			localPort: 43117,
		});
		expect(service.getActive()).toEqual(connection);
		expect(service.getConnection(profile.id)).toEqual(connection);

		const upload = invocations.find(
			(invocation) => invocation.options.inputFile,
		);
		expect(upload).toMatchObject({
			executable: "ssh",
			options: { inputFile: "/opt/cline/code-sidecar-linux-arm64" },
		});
		expect(upload?.args.at(-1)).toContain("umask 077; cat >");
		const ensure = invocations.find((invocation) =>
			invocation.args.at(-1)?.includes("--remote-hub-ensure"),
		);
		expect(ensure?.args.at(-1)).toContain("'/home/dev'");
		expect(ensure?.args.at(-1)).toMatch(
			/\/home\/dev\/\.cline\/data\/remote\/[a-f0-9-]+\.json/,
		);
		expect(spawnTunnel).toHaveBeenCalledWith(
			"ssh",
			expect.arrayContaining([
				"-N",
				"ExitOnForwardFailure=yes",
				"-L",
				"127.0.0.1:43117:127.0.0.1:25463",
				"arm-builder",
			]),
		);
		expect(waitForTunnel).toHaveBeenCalledWith(43117, tunnel, 10_000);

		await expect(service.disconnect()).resolves.toBe(true);
		expect(requestHubShutdown).toHaveBeenCalledWith(
			"ws://127.0.0.1:43117/hub",
			"remote-secret",
		);
		expect(tunnel.killed).toBe(true);
		expect(service.getActive()).toBeUndefined();
	});

	it.each([
		"reserve",
		"spawn",
		"ready",
	])("cleans up the owned remote Hub when %s fails", async (stage) => {
		const commands: string[] = [];
		const tunnel = new FakeTunnel();
		const fail = () => {
			throw new Error("tunnel setup failed");
		};
		const service = createService({
			runProcess: async (_executable, args) => {
				const command = args.at(-1) ?? "";
				commands.push(command);
				if (command.includes("uname -s"))
					return inspection("Linux", "aarch64", "/home/dev");
				if (command.includes("--remote-hub-ensure"))
					return success(
						'{"url":"ws://127.0.0.1:25463/hub","authToken":"secret"}',
					);
				return success();
			},
			resolveHelperBinary: async () => "/helper",
			fileReadable: async () => true,
			hashFile: async () => "abcdef0123456789fedcba9876543210",
			reservePort: async () => (stage === "reserve" ? fail() : 43117),
			spawnTunnel: () => (stage === "spawn" ? fail() : tunnel),
			waitForTunnel: async () => {
				if (stage === "ready") fail();
			},
		});
		const profile = await service.upsert({ name: "Remote", host: "remote" });
		await expect(service.connect(profile.id)).rejects.toThrow(
			"tunnel setup failed",
		);
		const ensure = commands.find((command) =>
			command.includes("--remote-hub-ensure"),
		);
		const stop = commands.find((command) =>
			command.includes("--remote-hub-stop"),
		);
		expect(stop).toBeDefined();
		expect(stop?.split("'--discovery-path' ")[1]).toBe(
			ensure?.split("'--discovery-path' ")[1],
		);
		expect(tunnel.killed).toBe(stage === "ready");
		expect(service.getConnection(profile.id)).toBeUndefined();
	});

	it("bounds Hub shutdown before closing the SSH tunnel", async () => {
		const tunnel = new FakeTunnel();
		const requestHubShutdown = vi.fn(
			async () => await new Promise<boolean>(() => undefined),
		);
		const service = createService(
			{
				runProcess: async (_executable, args) => {
					const command = args.at(-1) ?? "";
					if (command.includes("uname -s")) {
						return inspection("Linux", "aarch64", "/home/pi");
					}
					if (command.includes("--remote-hub-ensure")) {
						return success(
							'{"url":"ws://127.0.0.1:25463/hub","authToken":"token"}\n',
						);
					}
					return success();
				},
				resolveHelperBinary: async () => "/opt/cline/helper",
				fileReadable: async () => true,
				hashFile: async () => "0123456789abcdef",
				reservePort: async () => 43_000,
				spawnTunnel: () => tunnel,
				waitForTunnel: async () => undefined,
				requestHubShutdown,
			},
			{ hubShutdownTimeoutMs: 5 },
		);
		const profile = await service.upsert({ name: "Pi", host: "pi" });
		await service.connect(profile.id);

		await expect(service.disconnect(profile.id)).resolves.toBe(true);
		expect(requestHubShutdown).toHaveBeenCalledOnce();
		expect(tunnel.killed).toBe(true);
	});

	it("reuses an already-installed content-addressed helper", async () => {
		const invocations: Invocation[] = [];
		const service = createService({
			runProcess: async (executable, args, options) => {
				invocations.push({ executable, args, options });
				const command = args.at(-1) ?? "";
				if (command.includes("uname -s")) {
					return inspection("Darwin", "arm64", "/Users/dev");
				}
				if (command.includes("--remote-hub-ensure")) {
					return success(
						'{"url":"ws://localhost:29000/hub","authToken":"token"}\n',
					);
				}
				return success();
			},
			resolveHelperBinary: async () => "/Applications/Cline.app/sidecar",
			fileReadable: async () => true,
			hashFile: async () => "0123456789abcdef",
			reservePort: async () => 40000,
			spawnTunnel: () => new FakeTunnel(),
			waitForTunnel: async () => undefined,
		});
		const profile = await service.upsert({
			name: "Mac",
			host: "mac",
		});
		await service.connect(profile.id);

		expect(invocations.some((invocation) => invocation.options.inputFile)).toBe(
			false,
		);
	});

	it("allows renaming but keeps a profile's SSH destination immutable", async () => {
		const tunnel = new FakeTunnel();
		const spawnTunnel = vi.fn(() => tunnel);
		const service = createService({
			runProcess: async (_executable, args) => {
				const command = args.at(-1) ?? "";
				if (command.includes("uname -s")) {
					return inspection("Linux", "aarch64", "/home/pi");
				}
				if (command.includes("--remote-hub-ensure")) {
					return success(
						'{"url":"ws://127.0.0.1:25463/hub","authToken":"token"}\n',
					);
				}
				return success();
			},
			resolveHelperBinary: async () => "/opt/cline/helper",
			fileReadable: async () => true,
			hashFile: async () => "0123456789abcdef",
			reservePort: async () => 42_000,
			spawnTunnel,
			waitForTunnel: async () => undefined,
		});
		const created = await service.upsert({
			name: "Pi",
			host: "pi-from-ssh-config",
			user: "pi",
			identityFile: "/keys/pi_ed25519",
		});
		const first = await service.connect(created.id);

		const renamed = await service.upsert({
			...created,
			name: "Pi renamed",
		});
		expect(service.getConnection(created.id)?.profile).toEqual(renamed);
		await expect(service.connect(created.id)).resolves.toMatchObject({
			localPort: first.localPort,
			profile: renamed,
		});
		expect(spawnTunnel).toHaveBeenCalledTimes(1);

		for (const destinationUpdate of [
			{ host: "different-host" },
			{ user: "different-user" },
			{ port: 22 },
		]) {
			await expect(
				service.upsert({ ...renamed, ...destinationUpdate }),
			).rejects.toThrow("Create a new remote environment instead");
		}
		await expect(
			service.upsert({
				...renamed,
				identityFile: "/keys/replacement_ed25519",
			}),
		).rejects.toThrow("Disconnect the remote environment");

		expect(service.getConnection(created.id)).toMatchObject({
			localPort: first.localPort,
			profile: renamed,
		});
		expect(await service.list()).toEqual([renamed]);
		expect(spawnTunnel).toHaveBeenCalledTimes(1);
		expect(tunnel.killed).toBe(false);

		await service.disconnect(created.id);
		const updatedIdentity = await service.upsert({
			...renamed,
			identityFile: "/keys/replacement_ed25519",
		});
		expect(await service.list()).toEqual([updatedIdentity]);
	});

	it("fails clearly when no helper exists for the remote target and never downloads one", async () => {
		const invocations: Invocation[] = [];
		const service = createService({
			runProcess: async (executable, args, options) => {
				invocations.push({ executable, args, options });
				return args.at(-1)?.includes("uname -s")
					? inspection("Linux", "aarch64", "/home/dev")
					: success();
			},
			resolveHelperBinary: async () => undefined,
		});
		const profile = await service.upsert({
			name: "Remote",
			host: "remote",
		});

		await expect(service.connect(profile.id)).rejects.toThrow(
			"unsupported in SSH: no compatible remote helper binary",
		);
		expect(invocations.some((invocation) => invocation.options.inputFile)).toBe(
			false,
		);
	});

	it("keeps the active tunnel alive when a replacement connection fails", async () => {
		const tunnels: FakeTunnel[] = [];
		let nextPort = 41_000;
		const service = createService({
			runProcess: async (_executable, args) => {
				const destination = args.at(-2);
				const command = args.at(-1) ?? "";
				if (command.includes("uname -s")) {
					return inspection("Linux", "aarch64", "/home/dev");
				}
				if (command.includes("--remote-hub-ensure")) {
					return destination === "host-b"
						? { stdout: "", stderr: "bootstrap failed", exitCode: 1 }
						: success(
								'{"url":"ws://127.0.0.1:25463/hub","authToken":"token"}\n',
							);
				}
				return success();
			},
			resolveHelperBinary: async () => "/opt/cline/helper",
			fileReadable: async () => true,
			hashFile: async () => "0123456789abcdef",
			reservePort: async () => nextPort++,
			spawnTunnel: () => {
				const tunnel = new FakeTunnel();
				tunnels.push(tunnel);
				return tunnel;
			},
			waitForTunnel: async () => undefined,
		});
		const hostA = await service.upsert({
			name: "Host A",
			host: "host-a",
		});
		const hostB = await service.upsert({
			name: "Host B",
			host: "host-b",
		});

		const firstConnection = await service.connect(hostA.id);
		await expect(service.connect(hostB.id)).rejects.toThrow("bootstrap failed");

		expect(service.getActive()).toEqual(firstConnection);
		expect(service.getConnection(hostA.id)).toEqual(firstConnection);
		expect(tunnels[0]?.killed).toBe(false);
	});

	it("keeps the previous tunnel until the runtime switch commits", async () => {
		const tunnels: FakeTunnel[] = [];
		let nextPort = 42_000;
		const requestHubShutdown = vi.fn(async () => true);
		const service = createService({
			runProcess: async (_executable, args) => {
				const destination = args.at(-2) ?? "host-a";
				const command = args.at(-1) ?? "";
				if (command.includes("uname -s")) {
					return inspection("Linux", "aarch64", `/home/${destination}`);
				}
				if (command.includes("--remote-hub-ensure")) {
					return success(
						`{"url":"ws://127.0.0.1:25463/hub","authToken":"${destination}-token"}\n`,
					);
				}
				return success();
			},
			resolveHelperBinary: async () => "/opt/cline/helper",
			fileReadable: async () => true,
			hashFile: async () => "0123456789abcdef",
			reservePort: async () => nextPort++,
			spawnTunnel: () => {
				const tunnel = new FakeTunnel();
				tunnels.push(tunnel);
				return tunnel;
			},
			waitForTunnel: async () => undefined,
			requestHubShutdown,
		});
		const hostA = await service.upsert({ name: "Host A", host: "host-a" });
		const hostB = await service.upsert({ name: "Host B", host: "host-b" });

		const connectionA = await service.connect(hostA.id);
		const connectionB = await service.connect(hostB.id);

		expect(service.getActive()).toEqual(connectionB);
		expect(service.getConnection(hostA.id)).toEqual(connectionA);
		expect(service.getConnection(hostB.id)).toEqual(connectionB);
		expect(tunnels[0]?.killed).toBe(false);
		expect(requestHubShutdown).not.toHaveBeenCalled();

		expect(service.activateConnection(hostA.id)).toBe(true);
		expect(service.getActive()).toEqual(connectionA);
		expect(service.activateConnection("missing-host")).toBe(false);
		expect(service.getActive()).toEqual(connectionA);
		expect(service.activateConnection(hostB.id)).toBe(true);

		expect(await service.disconnect(hostA.id)).toBe(true);
		expect(tunnels[0]?.killed).toBe(true);
		expect(tunnels[1]?.killed).toBe(false);
		expect(service.getConnection(hostB.id)).toEqual(connectionB);
		expect(service.getActive()).toEqual(connectionB);
	});

	it("reports tunnel loss separately from ordinary connection errors", async () => {
		const tunnel = new FakeTunnel();
		const onConnectionLost = vi.fn();
		const requestHubShutdown = vi.fn(async () => true);
		const service = new RemoteEnvironmentService({
			profilesPath,
			onConnectionLost,
			dependencies: {
				now: () => new Date("2026-08-06T12:00:00.000Z"),
				randomId: () => "lost-profile",
				runProcess: async (_executable, args) => {
					const command = args.at(-1) ?? "";
					if (command.includes("uname -s")) {
						return inspection("Linux", "x86_64", "/home/dev");
					}
					if (command.includes("--remote-hub-ensure")) {
						return success(
							'{"url":"ws://127.0.0.1:25463/hub","authToken":"token"}\n',
						);
					}
					return success();
				},
				resolveHelperBinary: async () => "/opt/cline/helper",
				fileReadable: async () => true,
				hashFile: async () => "0123456789abcdef",
				reservePort: async () => 41_000,
				spawnTunnel: () => tunnel,
				waitForTunnel: async () => undefined,
				requestHubShutdown,
			},
		});
		const profile = await service.upsert({
			name: "Remote",
			host: "remote",
		});
		await service.connect(profile.id);

		tunnel.emit("exit", 255, null);

		expect(service.getActive()).toBeUndefined();
		expect(onConnectionLost).toHaveBeenCalledWith(
			expect.objectContaining({
				profileId: profile.id,
				state: "error",
			}),
		);
		// Cleanup uses a fresh SSH connection, never the failed local tunnel.
		await service.dispose();
		expect(requestHubShutdown).not.toHaveBeenCalled();
	});

	it("quotes command arguments and rejects non-zero remote commands", async () => {
		const invocations: Invocation[] = [];
		let failCommand = false;
		const service = createService({
			runProcess: async (executable, args, options) => {
				invocations.push({ executable, args, options });
				if (args.at(-1)?.includes("uname -s")) {
					return inspection("Linux", "x86_64", "/home/dev");
				}
				return failCommand
					? { stdout: "", stderr: "permission denied", exitCode: 13 }
					: success("ok");
			},
		});
		const profile = await service.upsert({ name: "Remote", host: "remote" });
		await expect(
			service.run(profile.id, {
				command: "printf",
				args: ["%s", "a'b; touch /tmp/not-created"],
				cwd: "/tmp/a b",
			}),
		).resolves.toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
		expect(invocations.at(-1)?.args.at(-1)).toBe(
			`cd '/tmp/a b' && exec 'printf' '%s' 'a'"'"'b; touch /tmp/not-created'`,
		);

		failCommand = true;
		await expect(
			service.run(profile.id, { command: "false", args: [] }),
		).rejects.toThrow("permission denied");
	});

	it("does not let a ProxyCommand warning mask the remote helper diagnostic", async () => {
		const service = createService({
			runProcess: async () => ({
				stdout: "Timed out waiting for detached hub startup.\n",
				stderr: "gcloud: NumPy is not installed; tunnel may be slower.\n",
				exitCode: 255,
			}),
		});
		const profile = await service.upsert({ name: "GCP", host: "gcp-iap" });

		const error = await service
			.run(profile.id, { command: "remote-helper", args: [] })
			.catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("exit 255");
		expect((error as Error).message).toContain(
			"gcloud: NumPy is not installed",
		);
		expect((error as Error).message).toContain(
			"Timed out waiting for detached hub startup",
		);
	});

	it("deletes profiles", async () => {
		const service = createService();
		const profile = await service.upsert({ name: "Remote", host: "remote" });

		await expect(service.delete(profile.id)).resolves.toBe(true);
		await expect(service.delete(profile.id)).resolves.toBe(false);
		await expect(service.list()).resolves.toEqual([]);
	});

	it("turns SSH failures into an error status during connection tests", async () => {
		const service = createService({
			runProcess: async () => ({
				stdout: "",
				stderr: "Host key verification failed",
				exitCode: 255,
			}),
		});
		const profile = await service.upsert({ name: "Remote", host: "remote" });
		await expect(service.test(profile.id)).resolves.toMatchObject({
			state: "error",
			message: expect.stringContaining("Host key verification failed"),
		});
	});
});
