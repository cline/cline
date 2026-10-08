import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, posix, resolve } from "node:path";
import type {
	SessionReplayRebuiltWorkspace,
	SessionReplayRecordedEnvironment,
	SessionReplayRerunReport,
} from "@cline/session";
import {
	assertEmptyOutDir,
	defaultRerunOutDir,
	describeRebuiltWorkspace,
	rootSessionOf,
	SessionRerunError,
	type SessionRerunInput,
	type SessionRerunOutcome,
} from "./rerun";

export interface SessionRerunContainerInput
	extends Omit<SessionRerunInput, "standalone" | "onProgress"> {
	/** Image to run in; defaults to `manifest.environment.image`. */
	image?: string;
	/** Container runtime binary. Default `docker`. */
	runtime?: string;
	/** The CLI command inside the image. Default `cline`. */
	cli?: string;
	/** Extra arguments for `<runtime> run`, before the image. */
	runtimeArgs?: string[];
}

/** Where the bundle, the out dir and settings are mounted in the container. */
export const CONTAINER_PATHS = {
	bundle: "/cline-replay/bundle",
	out: "/cline-replay/out",
	providers: "/cline-replay/providers.json",
	home: "/cline-replay/home",
} as const;

/** Env keys never copied from the recording into the container. */
const HOST_ONLY_ENV_KEYS = new Set(["PATH", "PWD", "OLDPWD", "SHLVL", "_"]);

function findFreePort(): Promise<number> {
	return new Promise((done, fail) => {
		const probe = createServer();
		probe.once("error", fail);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			const port = typeof address === "object" && address ? address.port : 0;
			probe.close(() => done(port));
		});
	});
}

function splitCommand(command: string): string[] {
	return command.trim().split(/\s+/).filter(Boolean);
}

/** The recorded env that is applied in the container, and what is left out. */
export function containerEnv(
	environment: Pick<SessionReplayRecordedEnvironment, "env">,
): { applied: Record<string, string>; skipped: string[] } {
	const applied: Record<string, string> = {};
	const skipped: string[] = [];
	for (const [key, value] of Object.entries(environment.env?.values ?? {})) {
		if (
			HOST_ONLY_ENV_KEYS.has(key) ||
			environment.env?.redactedKeys.includes(key)
		) {
			skipped.push(key);
			continue;
		}
		applied[key] = value;
	}
	return { applied, skipped };
}

export interface ContainerRerunCommand {
	runtime: string;
	args: string[];
}

/** The `<runtime> run ...` command a container rerun runs. */
export function buildContainerRerunCommand(input: {
	runtime: string;
	image: string;
	cli: string;
	runtimeArgs?: string[];
	recordedRoot: string;
	recordedCwd: string;
	workspaceRoot: string;
	bundleDir: string;
	containerOutDir: string;
	providersPath?: string;
	env: Record<string, string>;
	passEnv: string[];
	hubPort: number;
	user?: string;
	interactive?: boolean;
	rerunArgs: string[];
}): ContainerRerunCommand {
	const home = input.env.HOME || CONTAINER_PATHS.home;
	const env: Record<string, string> = {
		...input.env,
		HOME: home,
		CLINE_DATA_DIR: posix.join(CONTAINER_PATHS.out, "data"),
		CLINE_HUB_PORT: String(input.hubPort),
		...(input.providersPath
			? { CLINE_PROVIDER_SETTINGS_PATH: CONTAINER_PATHS.providers }
			: {}),
	};
	const args = [
		"run",
		"--rm",
		...(input.interactive ? ["-it"] : []),
		"--network",
		"host",
		...(input.user ? ["--user", input.user] : []),
		"--tmpfs",
		`${home}:rw,mode=1777`,
		"-v",
		`${input.workspaceRoot}:${input.recordedRoot}`,
		"-v",
		`${input.bundleDir}:${CONTAINER_PATHS.bundle}:ro`,
		"-v",
		`${input.containerOutDir}:${CONTAINER_PATHS.out}`,
		...(input.providersPath
			? ["-v", `${input.providersPath}:${CONTAINER_PATHS.providers}:ro`]
			: []),
		...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
		...input.passEnv.flatMap((key) => ["-e", key]),
		"-w",
		input.recordedCwd,
		...(input.runtimeArgs ?? []),
		input.image,
		...splitCommand(input.cli),
		"session",
		"replay",
		CONTAINER_PATHS.bundle,
		"--mode",
		"rerun",
		"--in-place",
		"--workspace",
		input.recordedRoot,
		"--out",
		CONTAINER_PATHS.out,
		"--format",
		"json",
		...input.rerunArgs,
	];
	return { runtime: input.runtime, args };
}

/** Flags the inner rerun gets from the outer one. */
export function innerRerunArgs(input: SessionRerunContainerInput): string[] {
	return [
		...(input.untilDivergence ? ["--until-divergence"] : ["--continue"]),
		...(input.ignore ? ["--ignore", input.ignore] : []),
		...(input.count ? ["--count", input.count] : []),
		...(input.lenient ? ["--lenient"] : []),
		...(input.interactive ? ["--interactive"] : []),
		...(input.model ? ["--model", input.model] : []),
		...(input.provider ? ["--provider", input.provider] : []),
	];
}

async function providerEnvKeys(provider: string): Promise<string[]> {
	const { Llms } = await import("@cline/core");
	const keys = (await Llms.getProviderCollection(provider))?.provider?.env;
	return (keys ?? []).filter((key) => Boolean(process.env[key]?.trim()));
}

/**
 * Reruns a bundle's root session inside a container. The workspace is
 * rebuilt on this machine as a standalone clone and mounted at the recorded
 * workspace path, so the session sees the paths it recorded; the recorded
 * env (minus host-only and redacted keys) is set in the container, and the
 * CLI in the image runs the rerun in place and writes its report and bundle
 * to a mounted directory. The bundle carries no image digest, so the image
 * is whatever `--image` names.
 */
export async function runSessionRerunInContainer(
	input: SessionRerunContainerInput,
): Promise<SessionRerunOutcome & { exitCode: number }> {
	const replay = await import("@cline/session");
	const { resolveProviderSettingsPath } = await import("@cline/shared/storage");
	const bundleDir = resolve(input.bundleDir);
	try {
		replay.resolveSessionReplayRerunKinds({
			ignore: input.ignore,
			count: input.count,
			lenient: input.lenient,
		});
	} catch (error) {
		throw new SessionRerunError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const bundle = await replay.readSessionReplayBundle(bundleDir);
	const session = rootSessionOf(bundle, input.sessionId);
	const environment = replay.describeSessionReplayEnvironment({
		manifest: bundle.manifest,
		session,
	});
	const image = input.image?.trim() || environment.image;
	if (!image) {
		throw new SessionRerunError(
			"--in-container needs --image <image>: the bundle does not name the image the session ran in (bundles carry no image digest).",
		);
	}
	const recordedRoot = environment.resolvedWorkspaceRoot;
	if (!recordedRoot) {
		throw new SessionRerunError(
			`The bundle's workspace path is redacted (${environment.workspaceRoot}) and could not be recovered, so there is no path to mount the workspace at. Rerun without --in-container and pass --workspace <path>.`,
		);
	}
	const recordedCwd =
		environment.cwdRelative === null || environment.cwdRelative === ""
			? recordedRoot
			: posix.join(recordedRoot, environment.cwdRelative);
	const outDir = resolve(input.outDir ?? defaultRerunOutDir(bundleDir));
	await assertEmptyOutDir(outDir);

	let workspace: SessionReplayRebuiltWorkspace;
	try {
		workspace = await replay.rebuildSessionReplayWorkspace({
			environment,
			parentDir: join(outDir, "workspace"),
			...(input.workspace ? { workspace: input.workspace } : {}),
			...(input.inPlace ? { inPlace: true } : {}),
			standalone: true,
		});
	} catch (error) {
		if (error instanceof replay.SessionReplayEnvironmentError) {
			throw new SessionRerunError(error.message);
		}
		throw error;
	}
	input.onNote?.(`workspace: ${describeRebuiltWorkspace(workspace)}`);
	for (const warning of workspace.warnings) {
		input.onNote?.(`warning: ${warning}`);
	}

	const containerOutDir = join(outDir, "container");
	await mkdir(containerOutDir, { recursive: true });
	const providersPath = resolveProviderSettingsPath();
	const env = containerEnv(environment);
	const runtime = input.runtime?.trim() || "docker";
	const command = buildContainerRerunCommand({
		runtime,
		image,
		cli: input.cli?.trim() || "cline",
		runtimeArgs: input.runtimeArgs,
		recordedRoot,
		recordedCwd,
		workspaceRoot: workspace.root,
		bundleDir,
		containerOutDir,
		...(existsSync(providersPath) ? { providersPath } : {}),
		env: env.applied,
		passEnv: await providerEnvKeys(
			input.provider?.trim() || session.entry.provider,
		),
		hubPort: await findFreePort(),
		...(typeof process.getuid === "function" &&
		typeof process.getgid === "function"
			? { user: `${process.getuid()}:${process.getgid()}` }
			: {}),
		interactive: input.interactive,
		rerunArgs: innerRerunArgs(input),
	});
	input.onNote?.(`container: ${runtime} ${command.args.join(" ")}`);

	const exitCode = await new Promise<number>((done, fail) => {
		const child = spawn(command.runtime, command.args, {
			stdio: [input.interactive ? "inherit" : "ignore", "ignore", "inherit"],
		});
		const abort = () => child.kill("SIGINT");
		input.signal?.addEventListener("abort", abort, { once: true });
		child.on("error", (error) => {
			input.signal?.removeEventListener("abort", abort);
			fail(
				new SessionRerunError(
					`Could not run ${command.runtime}: ${error.message}`,
				),
			);
		});
		child.on("close", (code) => {
			input.signal?.removeEventListener("abort", abort);
			done(code ?? 2);
		});
	});

	const innerReportPath = join(
		containerOutDir,
		replay.SESSION_REPLAY_RERUN_REPORT_FILE,
	);
	if (!existsSync(innerReportPath)) {
		throw new SessionRerunError(
			`The rerun in ${image} exited with ${exitCode} without writing a report.`,
		);
	}
	const inner = JSON.parse(
		await readFile(innerReportPath, "utf8"),
	) as SessionReplayRerunReport;
	const liveBundleDir = join(containerOutDir, "bundle");
	const validation = inner.live.bundleDir
		? await replay.validateSessionReplayBundle(liveBundleDir)
		: undefined;
	const report: SessionReplayRerunReport = {
		...inner,
		recorded: { ...inner.recorded, bundleDir },
		live: {
			sessionId: inner.live.sessionId,
			...(validation
				? { bundleDir: liveBundleDir, validated: validation.ok }
				: {}),
		},
		workspace: {
			method: workspace.method,
			source: workspace.source,
			root: workspace.root,
			cwd: workspace.cwd,
			...(workspace.checkpoint
				? {
						checkpoint: {
							ref: workspace.checkpoint.ref,
							kind: workspace.checkpoint.kind,
							base: workspace.checkpoint.base,
						},
					}
				: {}),
		},
		container: { runtime, image, command: [runtime, ...command.args] },
		env: { ...inner.env, applied: true },
		gaps: [
			...inner.gaps.filter(
				(gap) =>
					!gap.startsWith("the recorded env is compared, not applied") &&
					!gap.startsWith("no container image"),
			),
			`the image is ${image} as named on the command line, not verified against the recording`,
			...(env.skipped.length > 0
				? [`env not applied in the container: ${env.skipped.join(", ")}`]
				: []),
		],
		warnings: [...workspace.warnings, ...inner.warnings],
	};
	const reportPath = await replay.writeSessionReplayRerunReport(outDir, report);
	return {
		report,
		reportPath,
		outDir,
		exitCode: exitCode === 0 || exitCode === 1 ? exitCode : 2,
	};
}
