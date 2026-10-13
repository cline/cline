/**
 * Project sandbox for run_commands.
 *
 * When "Only allow edits in project directory" is on, commands run through
 * Microsoft's MXC sandbox (https://github.com/microsoft/mxc): they can read
 * anything but only write inside the project, temp folders, and package
 * manager caches. MXC is an optional dependency loaded at runtime; packaged
 * hosts ship it next to their executable or point CLINE_MXC_SDK_DIR at it
 * (see scripts/stage-mxc-runtime.ts).
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { pathToFileURL } from "node:url";

interface FilesystemFragment {
	readonlyPaths: string[];
	readwritePaths: string[];
}

interface MxcProcess {
	readonly standardInput: Writable | null;
	readonly standardOutput: Readable | null;
	readonly standardError: Readable | null;
	wait(): Promise<{ exitCode: number; timedOut: boolean }>;
	kill(): void;
	dispose(): void;
}

interface MxcModule {
	spawn(request: Record<string, unknown>): Promise<MxcProcess>;
	policy: {
		filesystem: {
			getAvailableToolsPolicy(): FilesystemFragment;
			getUserProfilePolicy(): FilesystemFragment;
		};
	};
}

export const PROJECT_SANDBOX_SETTING_LABEL =
	"Only allow edits in project directory";

const MXC_SDK_DIR_ENV = "CLINE_MXC_SDK_DIR";

/** Package manager caches that installs and builds need to write. */
const HOME_CACHE_DIRS = [
	".npm",
	".cache",
	".bun/install/cache",
	".cargo/registry",
	".cargo/git",
	"go/pkg/mod",
	".gradle",
	".m2/repository",
	".nuget/packages",
	".pnpm-store",
	".local/share/pnpm",
	"Library/Caches",
	"Library/pnpm/store",
];
const LOCAL_APP_DATA_CACHE_DIRS = ["npm-cache", "pip", "Yarn", "pnpm-cache"];

function cliPlatformPackageDir(): string | undefined {
	// The npm wrapper hard-links the platform binary into its own bin/, so
	// resolve the platform package that ships the runtime from the wrapper.
	const wrapperPath = process.env.CLINE_WRAPPER_PATH?.trim();
	if (!wrapperPath) {
		return undefined;
	}
	const platform = process.platform === "win32" ? "windows" : process.platform;
	try {
		return dirname(
			createRequire(wrapperPath).resolve(
				`@cline/cli-${platform}-${process.arch}/package.json`,
			),
		);
	} catch {
		return undefined;
	}
}

function mxcEntrypointCandidates(): string[] {
	const packagedRoots = [
		// Packaged CLI layout: <package>/bin/cline next to <package>/mxc.
		dirname(dirname(process.execPath)),
		cliPlatformPackageDir(),
	];
	const dirs = [
		process.env[MXC_SDK_DIR_ENV]?.trim(),
		...packagedRoots.map(
			(root) =>
				root && join(root, "mxc", "node_modules", "@microsoft", "mxc-sdk"),
		),
	];
	return dirs
		.filter((dir): dir is string => Boolean(dir))
		.map((dir) => join(dir, "dist", "v1", "index.js"));
}

let mxcModule: Promise<MxcModule> | undefined;

function loadMxc(): Promise<MxcModule> {
	mxcModule ??= (async () => {
		// Bun before 1.4 crashes the whole process in koffi's N-API finalizer.
		const [major = 0, minor = 0] = (process.versions.bun ?? "")
			.split(".")
			.map(Number);
		if (process.versions.bun && (major < 1 || (major === 1 && minor < 4))) {
			throw new Error(`Bun ${process.versions.bun} is too old`);
		}
		const entrypoint = mxcEntrypointCandidates().find((candidate) =>
			existsSync(candidate),
		);
		// A non-literal specifier keeps bundlers from inlining MXC, whose native
		// FFI layer must load from its installed package directory.
		const specifier = entrypoint
			? pathToFileURL(entrypoint).href
			: "@microsoft/mxc-sdk/v1";
		try {
			return (await import(specifier)) as MxcModule;
		} catch {
			throw new Error("the sandbox isn't included in this build of Cline");
		}
	})().catch((error) => {
		mxcModule = undefined;
		throw error;
	});
	return mxcModule;
}

function existing(paths: Array<string | undefined>): string[] {
	return [
		...new Set(paths.filter((path): path is string => Boolean(path))),
	].filter((path) => existsSync(path));
}

function buildFilesystemPolicy(mxc: MxcModule, cwd: string) {
	const home = homedir();
	const localAppData = process.env.LOCALAPPDATA;
	const readwritePaths = existing([
		cwd,
		tmpdir(),
		process.platform === "win32" ? undefined : "/tmp",
		...HOME_CACHE_DIRS.map((dir) => join(home, dir)),
		...(localAppData
			? LOCAL_APP_DATA_CACHE_DIRS.map((dir) => join(localAppData, dir))
			: []),
	]);
	if (process.platform !== "win32") {
		return { readwritePaths, readonlyPaths: ["/"] };
	}
	// Windows containers are deny-by-default and a drive-root grant does not
	// cascade, so grant reads to the profile and the toolchains on PATH.
	const tools = mxc.policy.filesystem.getAvailableToolsPolicy();
	const profile = mxc.policy.filesystem.getUserProfilePolicy();
	return {
		readwritePaths,
		readonlyPaths: existing([
			home,
			...tools.readonlyPaths,
			...tools.readwritePaths,
			...profile.readonlyPaths,
		]),
	};
}

function buildNetworkPolicy() {
	// Bubblewrap runs in its own network namespace and rejects ingress rules.
	if (process.platform === "linux") {
		return { egress: { default: "allow" } };
	}
	return {
		egress: { default: "allow" },
		ingress: { default: "allow", hostLoopback: "allow" },
	};
}

function quoteArg(arg: string): string {
	if (process.platform === "win32") {
		return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
	}
	return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

export interface ProjectSandboxSpawnConfig {
	executable: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
}

/**
 * Starts a command inside the project sandbox and returns a ChildProcess-like
 * handle so the shell executor can treat it like a regular child process.
 * It has no pid, so callers must kill it through `kill()`.
 */
export function spawnInProjectSandbox(
	config: ProjectSandboxSpawnConfig,
): ChildProcess {
	const handle = new SandboxedProcess();
	void loadMxc()
		.then((mxc) =>
			mxc.spawn({
				command: [config.executable, ...config.args].map(quoteArg).join(" "),
				workingDirectory: config.cwd,
				environment: { ...process.env, ...config.env },
				filesystem: buildFilesystemPolicy(mxc, config.cwd),
				network: buildNetworkPolicy(),
			}),
		)
		.then(
			(sandboxed) => handle.attach(sandboxed),
			(error: unknown) => {
				const reason = error instanceof Error ? error.message : String(error);
				handle.fail(
					new Error(
						`Couldn't keep this command inside your project (${reason}). To run it anyway, turn off "${PROJECT_SANDBOX_SETTING_LABEL}" in Settings.`,
					),
				);
			},
		);
	return handle as unknown as ChildProcess;
}

class SandboxedProcess extends EventEmitter {
	readonly pid = undefined;
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	private process: MxcProcess | undefined;
	private killRequested = false;

	attach(sandboxed: MxcProcess): void {
		if (this.killRequested) {
			sandboxed.kill();
			sandboxed.dispose();
			return;
		}
		this.process = sandboxed;
		this.emit("spawn");
		if (sandboxed.standardInput) {
			this.stdin.pipe(sandboxed.standardInput);
		} else {
			this.stdin.resume();
		}
		const outputsClosed = Promise.all([
			pipeTo(sandboxed.standardOutput, this.stdout),
			pipeTo(sandboxed.standardError, this.stderr),
		]);
		sandboxed.wait().then(
			async ({ exitCode }) => {
				this.exitCode = exitCode;
				this.emit("exit", exitCode, null);
				await outputsClosed;
				sandboxed.dispose();
				this.emit("close", exitCode, null);
			},
			(error: unknown) => {
				sandboxed.dispose();
				this.fail(error instanceof Error ? error : new Error(String(error)));
			},
		);
	}

	fail(error: Error): void {
		this.stdout.end();
		this.stderr.end();
		this.emit("error", error);
	}

	kill(): boolean {
		this.killRequested = true;
		this.process?.kill();
		return true;
	}

	unref(): void {}
}

function pipeTo(source: Readable | null, target: PassThrough): Promise<void> {
	return new Promise((resolve) => {
		target.once("end", resolve);
		if (source) {
			source.pipe(target);
		} else {
			target.end();
		}
	});
}
