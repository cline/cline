import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
	recordedMessageContentSha256,
	SENSITIVE_DATA_REDACTED_VALUE,
	SENSITIVE_VALUE_PATTERNS,
	type SessionReplayBundleManifest,
	type SessionReplayCheckpointRef,
} from "@cline/shared";
import type { LoadedSessionReplaySession } from "./bundle-io";
import type { SessionReplaySessionData } from "./replay-compare";

const execFile = promisify(execFileCallback);

/**
 * What a bundle records about the environment its root session ran in, as
 * far as a rerun can use it. Only the starting checkpoint is required to
 * rebuild the workspace; env, host and image are compared or applied when
 * present.
 */
export interface SessionReplayRecordedEnvironment {
	sessionId: string;
	/** `workspaceRoot` as written in the manifest (may be redacted). */
	workspaceRoot: string;
	/** `cwd` as written in the manifest (may be redacted). */
	cwd: string;
	/**
	 * The real recorded workspace root. Equal to `workspaceRoot` unless that
	 * was redacted, in which case it is recovered from the verbatim recorded
	 * system prompt; absent when it cannot be recovered.
	 */
	resolvedWorkspaceRoot?: string;
	resolvedFrom?: "manifest" | "system-prompt";
	/** `cwd` relative to the workspace root; null when it lies outside it. */
	cwdRelative: string | null;
	/** Checkpoint of the session's first run, the workspace before it started. */
	startCheckpoint?: SessionReplayCheckpointRef;
	/** First recording segment's allowlisted env; values may be redacted. */
	env?: {
		values: Record<string, string>;
		sha256: string;
		redactedKeys: string[];
	};
	host?: { platform: string; arch: string; node: string };
	mode: string | null;
	toolPolicies?: Record<string, unknown>;
	/** Container image from `manifest.environment.image`, when a producer set one. */
	image?: string;
	/** Things the bundle does not carry that an exact rerun would need. */
	gaps: string[];
}

export class SessionReplayEnvironmentError extends Error {
	readonly code:
		| "workspace-missing"
		| "workspace-redacted"
		| "not-a-repo"
		| "checkpoint-missing"
		| "no-checkpoint"
		| "target-exists";

	constructor(code: SessionReplayEnvironmentError["code"], message: string) {
		super(message);
		this.name = "SessionReplayEnvironmentError";
		this.code = code;
	}
}

const REDACTED_PLACEHOLDERS = SENSITIVE_VALUE_PATTERNS.map(
	(pattern) => pattern.replacement,
);

function isRedactedValue(value: string): boolean {
	return (
		value === SENSITIVE_DATA_REDACTED_VALUE ||
		REDACTED_PLACEHOLDERS.some((placeholder) => value.includes(placeholder))
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A pattern matching the original of a path the home-path redaction rules
 * rewrote, e.g. `/home/REDACTED_USER/app` matches `/home/alice/app`.
 */
function redactedPathPattern(path: string): RegExp {
	let source = escapeRegExp(path);
	for (const placeholder of REDACTED_PLACEHOLDERS) {
		const escaped = escapeRegExp(placeholder);
		const prefix = escapeRegExp(placeholder.replace(/REDACTED_USER$/, ""));
		source = source.split(escaped).join(`${prefix}[A-Za-z0-9._-]+`);
	}
	return new RegExp(`${source}(?![A-Za-z0-9._-])`);
}

function recordedSystemPrompts(session: SessionReplaySessionData): string[] {
	const prompts: string[] = [];
	if (session.transcript.systemPrompt) {
		prompts.push(session.transcript.systemPrompt);
	}
	for (const blob of session.blobs.values()) {
		if (blob.kind === "system-prompt" && typeof blob.value === "string") {
			prompts.push(blob.value);
		}
	}
	return prompts;
}

function resolveWorkspaceRoot(
	workspaceRoot: string,
	session: SessionReplaySessionData,
): Pick<
	SessionReplayRecordedEnvironment,
	"resolvedWorkspaceRoot" | "resolvedFrom"
> {
	if (!workspaceRoot) return {};
	if (!isRedactedValue(workspaceRoot)) {
		return { resolvedWorkspaceRoot: workspaceRoot, resolvedFrom: "manifest" };
	}
	const pattern = redactedPathPattern(workspaceRoot);
	for (const prompt of recordedSystemPrompts(session)) {
		const match = pattern.exec(prompt);
		if (match?.[0]) {
			return { resolvedWorkspaceRoot: match[0], resolvedFrom: "system-prompt" };
		}
	}
	return {};
}

function cwdRelativeTo(root: string, cwd: string): string | null {
	if (!root || !cwd) return null;
	if (isRedactedValue(root) || isRedactedValue(cwd)) {
		if (cwd === root) return "";
		return cwd.startsWith(`${root}/`) ? cwd.slice(root.length + 1) : null;
	}
	const rel = relative(root, cwd);
	return rel.startsWith("..") || isAbsolute(rel) ? null : rel;
}

function startCheckpointOf(
	entry: LoadedSessionReplaySession["entry"],
): SessionReplayCheckpointRef | undefined {
	const first = entry.iterations?.find((point) => point.index === 1);
	if (first?.checkpoint) {
		const { capture: _capture, ...checkpoint } = first.checkpoint;
		return checkpoint;
	}
	return entry.checkpoints
		.filter((checkpoint) => checkpoint.runCount === 1)
		.sort((a, b) => b.createdAt - a.createdAt)[0];
}

/** Reads what a rerun can use about a bundle session's environment. */
export function describeSessionReplayEnvironment(input: {
	manifest: Pick<SessionReplayBundleManifest, "environment">;
	session: Pick<LoadedSessionReplaySession, "entry"> & SessionReplaySessionData;
}): SessionReplayRecordedEnvironment {
	const { entry } = input.session;
	const segment = entry.recording?.segments[0];
	const gaps: string[] = [];
	const startCheckpoint = startCheckpointOf(entry);
	if (!startCheckpoint) {
		gaps.push(
			entry.checkpoints.length > 0
				? `no checkpoint for the first run (checkpoints start at run ${Math.min(...entry.checkpoints.map((checkpoint) => checkpoint.runCount))})`
				: "no workspace checkpoint (the session ran outside a git repository or with checkpoints off)",
		);
	}
	const resolved = resolveWorkspaceRoot(entry.workspaceRoot, input.session);
	if (isRedactedValue(entry.workspaceRoot) && !resolved.resolvedWorkspaceRoot) {
		gaps.push("the workspace path is redacted and not recoverable");
	}
	const image =
		typeof input.manifest.environment?.image === "string"
			? input.manifest.environment.image
			: undefined;
	if (!image) {
		gaps.push("no container image (the bundle schema has no image digest)");
	}
	if (!segment) {
		gaps.push("no recording segment (env, host and tool policies unknown)");
	}
	const env = segment
		? {
				values: segment.env,
				sha256: segment.envSha256,
				redactedKeys: Object.entries(segment.env)
					.filter(([, value]) => isRedactedValue(value))
					.map(([key]) => key),
			}
		: undefined;
	if (env && env.redactedKeys.length > 0) {
		gaps.push(`redacted env values: ${env.redactedKeys.join(", ")}`);
	}
	return {
		sessionId: entry.sessionId,
		workspaceRoot: entry.workspaceRoot,
		cwd: entry.cwd,
		...resolved,
		cwdRelative: cwdRelativeTo(entry.workspaceRoot, entry.cwd),
		...(startCheckpoint ? { startCheckpoint } : {}),
		...(env ? { env } : {}),
		...(segment ? { host: segment.host } : {}),
		mode: segment?.mode ?? null,
		...(segment?.toolPolicies ? { toolPolicies: segment.toolPolicies } : {}),
		...(image ? { image } : {}),
		gaps,
	};
}

export interface RebuildSessionReplayWorkspaceOptions {
	environment: SessionReplayRecordedEnvironment;
	/**
	 * Directory the fresh copy is created in, as `<parentDir>/<name>` where
	 * `name` is the recorded workspace's base name (so prompts that name the
	 * workspace still read the same).
	 */
	parentDir: string;
	/** Workspace or repository to restore from instead of the recorded root. */
	workspace?: string;
	/** Run in the workspace itself: no copy, no restore. */
	inPlace?: boolean;
}

export interface SessionReplayRebuiltWorkspace {
	/**
	 * `checkpoint`: a fresh clone at the starting checkpoint. `copy`: a copy
	 * of `--workspace` as it is now (the bundle had no checkpoint).
	 * `in-place`: the workspace itself.
	 */
	method: "checkpoint" | "copy" | "in-place";
	/** Where the files came from. */
	source: string;
	sourceKind: "recorded" | "override";
	root: string;
	cwd: string;
	checkpoint?: {
		ref: string;
		kind: "stash" | "commit";
		/** Commit the copy's HEAD is detached at. */
		base: string;
		/** The stash snapshot also carried untracked files. */
		untracked: boolean;
	};
	warnings: string[];
}

async function git(cwd: string, args: string[]): Promise<string> {
	const result = await execFile("git", ["-C", cwd, ...args], {
		windowsHide: true,
		maxBuffer: 64 * 1024 * 1024,
	});
	return result.stdout.trim();
}

async function gitSucceeds(cwd: string, args: string[]): Promise<boolean> {
	try {
		await git(cwd, args);
		return true;
	} catch {
		return false;
	}
}

async function checkpointKind(
	source: string,
	checkpoint: SessionReplayCheckpointRef,
): Promise<"stash" | "commit"> {
	if (checkpoint.kind) return checkpoint.kind;
	const parents = (
		await git(source, ["show", "-s", "--format=%P", checkpoint.ref])
	)
		.split(/\s+/)
		.filter(Boolean);
	return parents.length >= 2 ? "stash" : "commit";
}

async function isNonEmptyDir(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory() && (await readdir(path)).length > 0;
	} catch {
		return false;
	}
}

function describeCheckpoint(checkpoint: SessionReplayCheckpointRef): string {
	return `${checkpoint.ref.slice(0, 12)}${checkpoint.kind ? ` (${checkpoint.kind})` : ""}`;
}

/**
 * Rebuilds the workspace a session started in. By default the result is a
 * fresh clone of the source repository (`git clone --shared`, so the source
 * is never written to) with HEAD detached at the checkpoint's base commit
 * and, for stash checkpoints, the snapshot's tracked and untracked changes
 * applied. A bundle carries checkpoint refs, not files: the repository that
 * holds those objects has to be on this machine, at the recorded path or
 * named by `workspace`. Nothing is guessed; every missing piece throws a
 * {@link SessionReplayEnvironmentError} saying what to pass instead.
 */
export async function rebuildSessionReplayWorkspace(
	options: RebuildSessionReplayWorkspaceOptions,
): Promise<SessionReplayRebuiltWorkspace> {
	const { environment } = options;
	const warnings: string[] = [];
	const override = options.workspace?.trim()
		? resolve(options.workspace.trim())
		: undefined;
	const recordedRoot = environment.resolvedWorkspaceRoot;
	const source = override ?? recordedRoot;
	if (!source) {
		throw new SessionReplayEnvironmentError(
			"workspace-redacted",
			`The bundle's workspace path is redacted (${environment.workspaceRoot}) and could not be recovered, so the workspace to restore from is unknown. Pass --workspace <path> with the repository the session ran in.`,
		);
	}
	if (!existsSync(source)) {
		throw new SessionReplayEnvironmentError(
			"workspace-missing",
			override
				? `--workspace ${override} does not exist.`
				: `The recorded workspace ${source} is not on this machine. A bundle carries checkpoint refs, not the workspace files: pass --workspace <path> with a checkout of the repository${environment.startCheckpoint ? ` that contains checkpoint ${describeCheckpoint(environment.startCheckpoint)}` : ""}.`,
		);
	}
	const sourceKind = override ? "override" : "recorded";
	const cwdIn = (root: string) => {
		if (environment.cwdRelative === null) {
			warnings.push(
				`The recorded cwd ${environment.cwd} is outside the workspace root; using the workspace root.`,
			);
			return root;
		}
		return environment.cwdRelative ? join(root, environment.cwdRelative) : root;
	};

	if (options.inPlace) {
		const checkpoint = environment.startCheckpoint;
		if (checkpoint && (await gitSucceeds(source, ["rev-parse", "HEAD"]))) {
			const kind = await checkpointKind(source, checkpoint).catch(
				() => checkpoint.kind ?? "commit",
			);
			const base = await git(source, [
				"rev-parse",
				"--verify",
				`${kind === "commit" ? checkpoint.ref : `${checkpoint.ref}^1`}^{commit}`,
			]).catch(() => undefined);
			const head = await git(source, ["rev-parse", "HEAD"]);
			if (!base) {
				warnings.push(
					`Checkpoint ${describeCheckpoint(checkpoint)} is not in ${source}; the in-place workspace may not match the recording's start.`,
				);
			} else if (base !== head) {
				warnings.push(
					`${source} is at ${head.slice(0, 12)}, not at the starting checkpoint's commit ${base.slice(0, 12)}; the workspace was not restored.`,
				);
			} else if (kind === "stash") {
				warnings.push(
					`${source} is at the starting commit, but uncommitted changes are not compared with checkpoint ${describeCheckpoint(checkpoint)}.`,
				);
			}
		} else if (!checkpoint) {
			warnings.push(
				"The bundle has no starting checkpoint; the workspace is used as it is.",
			);
		}
		return {
			method: "in-place",
			source,
			sourceKind,
			root: source,
			cwd: cwdIn(source),
			warnings,
		};
	}

	const name = basename(recordedRoot ?? source) || "workspace";
	const target = join(resolve(options.parentDir), name);
	if (await isNonEmptyDir(target)) {
		throw new SessionReplayEnvironmentError(
			"target-exists",
			`${target} already exists and is not empty.`,
		);
	}
	await mkdir(resolve(options.parentDir), { recursive: true });

	const checkpoint = environment.startCheckpoint;
	if (!checkpoint) {
		if (!override) {
			throw new SessionReplayEnvironmentError(
				"no-checkpoint",
				"The bundle has no starting workspace checkpoint (the session ran outside a git repository, or checkpoints were off), so its workspace cannot be restored. Pass --workspace <path> to rerun in a copy of a workspace you choose, or --in-place to run in it directly.",
			);
		}
		await cp(source, target, {
			recursive: true,
			verbatimSymlinks: true,
			errorOnExist: true,
		});
		warnings.push(
			`The bundle has no starting checkpoint; copied ${source} as it is now.`,
		);
		return {
			method: "copy",
			source,
			sourceKind,
			root: target,
			cwd: cwdIn(target),
			warnings,
		};
	}

	if (!(await gitSucceeds(source, ["rev-parse", "--git-dir"]))) {
		throw new SessionReplayEnvironmentError(
			"not-a-repo",
			`${source} is not a git repository, so checkpoint ${describeCheckpoint(checkpoint)} cannot be restored from it.`,
		);
	}
	if (
		!(await gitSucceeds(source, [
			"cat-file",
			"-e",
			`${checkpoint.ref}^{commit}`,
		]))
	) {
		throw new SessionReplayEnvironmentError(
			"checkpoint-missing",
			`Checkpoint ${describeCheckpoint(checkpoint)} is not in ${source}. Checkpoints are local commits (stash snapshots are kept under refs/cline/checkpoints/ and never pushed), so another clone does not have them: point --workspace at the repository the session ran in.`,
		);
	}
	const kind = await checkpointKind(source, checkpoint);
	const base = await git(source, [
		"rev-parse",
		"--verify",
		`${kind === "commit" ? checkpoint.ref : `${checkpoint.ref}^1`}^{commit}`,
	]);
	const untracked =
		kind === "stash" &&
		(await gitSucceeds(source, [
			"cat-file",
			"-e",
			`${checkpoint.ref}^3^{commit}`,
		]));
	const sourceTop = await git(source, ["rev-parse", "--show-toplevel"]).catch(
		() => source,
	);
	await execFile(
		"git",
		["clone", "--quiet", "--shared", "--no-checkout", sourceTop, target],
		{ windowsHide: true },
	);
	await git(target, ["checkout", "--quiet", "--detach", base]);
	if (kind === "stash") {
		await git(target, ["stash", "apply", "--quiet", checkpoint.ref]);
	}
	if (existsSync(join(target, ".gitmodules"))) {
		warnings.push("Submodules are not restored.");
	}
	const sourceRel = relative(sourceTop, source);
	const root =
		sourceRel && !sourceRel.startsWith("..") ? join(target, sourceRel) : target;
	return {
		method: "checkpoint",
		source,
		sourceKind,
		root,
		cwd: cwdIn(root),
		checkpoint: { ref: checkpoint.ref, kind, base, untracked },
		warnings,
	};
}

/**
 * Rewrites the recorded workspace root to the rebuilt one in what a rerun
 * sends (prompts, system prompt), and back in what it compares, so a rerun
 * in a fresh copy neither touches the recorded workspace through absolute
 * paths nor reports the different location as drift.
 */
export interface SessionReplayPathMap {
	recorded: string;
	live: string;
	identity: boolean;
	toLive<T>(value: T): T;
	toRecorded<T>(value: T): T;
}

function mapStrings<T>(value: T, replace: (text: string) => string): T {
	if (typeof value === "string") return replace(value) as T;
	if (Array.isArray(value)) {
		return value.map((item) => mapStrings(item, replace)) as T;
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = mapStrings(item, replace);
		}
		return out as T;
	}
	return value;
}

export function createSessionReplayPathMap(
	recorded: string,
	live: string,
): SessionReplayPathMap {
	const identity = !recorded || !live || resolve(recorded) === resolve(live);
	const swap = (from: string, to: string) => (text: string) =>
		text.includes(from) ? text.split(from).join(to) : text;
	const toLive = swap(recorded, live);
	const toRecorded = swap(live, recorded);
	return {
		recorded,
		live,
		identity,
		toLive: (value) => (identity ? value : mapStrings(value, toLive)),
		toRecorded: (value) => (identity ? value : mapStrings(value, toRecorded)),
	};
}

/**
 * A live session's data with the rebuilt workspace path mapped back to the
 * recorded one. Message blob `contentSha256` is recomputed so request
 * messages that differ only by location align as equal.
 */
export function mapSessionReplaySessionData(
	session: SessionReplaySessionData,
	map: SessionReplayPathMap,
): SessionReplaySessionData {
	if (map.identity) return session;
	const blobs = new Map(
		[...session.blobs].map(([sha256, blob]) => {
			const value = map.toRecorded(blob.value);
			const mapped = { ...blob, value };
			if (
				blob.kind === "message" &&
				value &&
				typeof value === "object" &&
				"role" in value &&
				"content" in value
			) {
				mapped.contentSha256 = recordedMessageContentSha256(
					value as { role: string; content: unknown },
				);
			}
			return [sha256, mapped] as const;
		}),
	);
	return {
		transcript: map.toRecorded(session.transcript),
		events: session.events.map((event) => ({
			...event,
			payload: map.toRecorded(event.payload),
		})),
		requests: session.requests,
		blobs,
	};
}

export interface SessionReplayEnvComparison {
	/** Same allowlisted keys and values (or the same hash). */
	same: boolean;
	changed: Array<{ key: string; recorded?: string; live?: string }>;
	/** Recorded keys whose value was redacted, so they were not compared. */
	unknown: string[];
}

/** Compares the recorded allowlisted env with the env the rerun's commands got. */
export function compareSessionReplayEnv(
	recorded: SessionReplayRecordedEnvironment["env"],
	live: { values: Record<string, string>; sha256: string } | undefined,
): SessionReplayEnvComparison {
	if (!recorded || !live) {
		return { same: !recorded && !live, changed: [], unknown: [] };
	}
	if (recorded.sha256 === live.sha256) {
		return { same: true, changed: [], unknown: [] };
	}
	const unknown = recorded.redactedKeys;
	const changed: SessionReplayEnvComparison["changed"] = [];
	for (const key of [
		...new Set([...Object.keys(recorded.values), ...Object.keys(live.values)]),
	].sort()) {
		if (unknown.includes(key)) continue;
		const r = recorded.values[key];
		const l = live.values[key];
		if (r !== l) {
			changed.push({
				key,
				...(r !== undefined ? { recorded: r } : {}),
				...(l !== undefined ? { live: l } : {}),
			});
		}
	}
	return {
		same: changed.length === 0 && unknown.length === 0,
		changed,
		unknown,
	};
}
