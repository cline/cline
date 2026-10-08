import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	SessionReplayBundleManifest,
	SessionReplayCheckpointRef,
	SessionReplaySessionEntry,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LoadedSessionReplaySession } from "./bundle-io";
import {
	compareSessionReplayEnv,
	createSessionReplayPathMap,
	describeSessionReplayEnvironment,
	mapSessionReplaySessionData,
	rebuildSessionReplayWorkspace,
	SessionReplayEnvironmentError,
	type SessionReplayRecordedEnvironment,
} from "./replay-environment";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Replay Test",
			GIT_AUTHOR_EMAIL: "replay@example.com",
			GIT_COMMITTER_NAME: "Replay Test",
			GIT_COMMITTER_EMAIL: "replay@example.com",
		},
	}).trim();
}

function session(
	entry: Partial<SessionReplaySessionEntry>,
	systemPrompt?: string,
): LoadedSessionReplaySession {
	return {
		entry: {
			sessionId: "sess_env",
			role: "root",
			parentSessionId: null,
			agentId: null,
			parentAgentId: null,
			conversationId: null,
			source: "cli",
			status: "completed",
			exitCode: 0,
			startedAt: "2026-01-01T00:00:00.000Z",
			endedAt: null,
			interactive: false,
			provider: "openai-compatible",
			model: "fake-model",
			cwd: "/w",
			workspaceRoot: "/w",
			team: null,
			checkpoints: [],
			eventsSource: "recording",
			counts: { messages: 0, iterations: 0, events: 0 },
			recording: null,
			...entry,
		} as SessionReplaySessionEntry,
		transcript: {
			sessionId: "sess_env",
			...(systemPrompt ? { systemPrompt } : {}),
			messages: [],
		},
		events: [],
		requests: [],
		blobs: new Map(),
	};
}

const manifest: Pick<SessionReplayBundleManifest, "environment"> = {};

function describeFor(
	entry: Partial<SessionReplaySessionEntry>,
	systemPrompt?: string,
): SessionReplayRecordedEnvironment {
	return describeSessionReplayEnvironment({
		manifest,
		session: session(entry, systemPrompt),
	});
}

describe("describeSessionReplayEnvironment", () => {
	const checkpoint = (runCount: number, createdAt: number) =>
		({
			ref: `ref_${runCount}_${createdAt}`,
			kind: "stash",
			runCount,
			createdAt,
		}) satisfies SessionReplayCheckpointRef;

	it("uses the first iteration's checkpoint, else the latest first-run checkpoint", () => {
		expect(
			describeFor({
				checkpoints: [checkpoint(1, 1), checkpoint(1, 5), checkpoint(2, 9)],
			}).startCheckpoint?.ref,
		).toBe("ref_1_5");
		expect(
			describeFor({
				checkpoints: [checkpoint(1, 5)],
				iterations: [
					{
						index: 1,
						checkpoint: { ...checkpoint(1, 1), capture: "run-start" },
					},
				],
			}).startCheckpoint,
		).toEqual(checkpoint(1, 1));
	});

	it("lists what the bundle does not carry", () => {
		const environment = describeFor({ checkpoints: [checkpoint(2, 1)] });
		expect(environment.startCheckpoint).toBeUndefined();
		expect(environment.gaps).toEqual(
			expect.arrayContaining([
				"no checkpoint for the first run (checkpoints start at run 2)",
				"no container image (the bundle schema has no image digest)",
				"no recording segment (env, host and tool policies unknown)",
			]),
		);
	});

	it("recovers a redacted workspace path from the verbatim system prompt", () => {
		const environment = describeFor(
			{
				workspaceRoot: "/home/REDACTED_USER/proj",
				cwd: "/home/REDACTED_USER/proj/pkg",
			},
			"Workspace: /home/alice/proj\nOther: /home/alice/projects-old",
		);
		expect(environment.resolvedWorkspaceRoot).toBe("/home/alice/proj");
		expect(environment.resolvedFrom).toBe("system-prompt");
		expect(environment.cwdRelative).toBe("pkg");
	});

	it("leaves a redacted path unresolved when nothing reveals it", () => {
		const environment = describeFor({
			workspaceRoot: "/home/REDACTED_USER/proj",
			cwd: "/home/REDACTED_USER/proj",
		});
		expect(environment.resolvedWorkspaceRoot).toBeUndefined();
		expect(environment.gaps).toContain(
			"the workspace path is redacted and not recoverable",
		);
	});

	it("reads env, host, mode and redacted env keys from the first segment", () => {
		const environment = describeFor({
			recording: {
				segments: [
					{
						startedAt: "2026-01-01T00:00:00.000Z",
						pid: 1,
						leadAgentId: "agent_1",
						initialMessageCount: 0,
						firstSeq: 0,
						mode: "act",
						cwd: "/w",
						host: { platform: "linux", arch: "x64", node: "v22.0.0" },
						env: { PATH: "/usr/bin", HOME: "/home/REDACTED_USER" },
						envSha256: "a".repeat(64),
					},
				],
				counts: { modelCalls: 0, blobs: 0, decisions: 0 },
				coverage: {
					assistantMessages: 0,
					linked: 0,
					unlinkedMessageIds: [],
				},
			},
		} as unknown as Partial<SessionReplaySessionEntry>);
		expect(environment.mode).toBe("act");
		expect(environment.host).toEqual({
			platform: "linux",
			arch: "x64",
			node: "v22.0.0",
		});
		expect(environment.env?.redactedKeys).toEqual(["HOME"]);
	});
});

describe("rebuildSessionReplayWorkspace", () => {
	let root: string;
	let repo: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "replay-env-"));
		repo = join(root, "proj");
		mkdirSync(join(repo, "pkg"), { recursive: true });
		git(repo, "init", "--quiet");
		writeFileSync(join(repo, "a.txt"), "one\n");
		writeFileSync(join(repo, "pkg", "b.txt"), "base\n");
		git(repo, "add", ".");
		git(repo, "commit", "--quiet", "-m", "base");
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	/** A stash-shaped checkpoint (tracked + untracked) the way the checkpoint hook keeps it. */
	function stashCheckpoint(): SessionReplayCheckpointRef {
		writeFileSync(join(repo, "a.txt"), "two\n");
		writeFileSync(join(repo, "pkg", "new.txt"), "untracked\n");
		git(repo, "stash", "push", "--quiet", "--include-untracked", "-m", "cp");
		const ref = git(repo, "rev-parse", "stash@{0}");
		git(repo, "update-ref", "refs/cline/checkpoints/sess_env/1", ref);
		git(repo, "stash", "drop", "--quiet");
		return { ref, kind: "stash", runCount: 1, createdAt: 1 };
	}

	function environmentFor(
		startCheckpoint: SessionReplayCheckpointRef | undefined,
		overrides: Partial<SessionReplayRecordedEnvironment> = {},
	): SessionReplayRecordedEnvironment {
		return {
			sessionId: "sess_env",
			workspaceRoot: repo,
			cwd: join(repo, "pkg"),
			resolvedWorkspaceRoot: repo,
			resolvedFrom: "manifest",
			cwdRelative: "pkg",
			...(startCheckpoint ? { startCheckpoint } : {}),
			mode: "act",
			gaps: [],
			...overrides,
		};
	}

	it("restores a stash checkpoint into a fresh clone without touching the source", async () => {
		const checkpoint = stashCheckpoint();
		writeFileSync(join(repo, "a.txt"), "later\n");
		const rebuilt = await rebuildSessionReplayWorkspace({
			environment: environmentFor(checkpoint),
			parentDir: join(root, "out"),
		});
		expect(rebuilt.method).toBe("checkpoint");
		expect(rebuilt.root).toBe(join(root, "out", "proj"));
		expect(rebuilt.cwd).toBe(join(root, "out", "proj", "pkg"));
		expect(rebuilt.checkpoint).toMatchObject({
			ref: checkpoint.ref,
			kind: "stash",
			base: git(repo, "rev-parse", "HEAD"),
			untracked: true,
		});
		expect(readFileSync(join(rebuilt.root, "a.txt"), "utf8")).toBe("two\n");
		expect(readFileSync(join(rebuilt.root, "pkg", "new.txt"), "utf8")).toBe(
			"untracked\n",
		);
		expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("later\n");
		expect(existsSync(join(repo, "pkg", "new.txt"))).toBe(false);
		expect(git(repo, "status", "--porcelain")).toBe("M a.txt");
	});

	it("makes a standalone clone that does not borrow the source's objects", async () => {
		const checkpoint = stashCheckpoint();
		const rebuilt = await rebuildSessionReplayWorkspace({
			environment: environmentFor(checkpoint),
			parentDir: join(root, "out"),
			standalone: true,
		});
		expect(
			existsSync(join(rebuilt.root, ".git", "objects", "info", "alternates")),
		).toBe(false);
		expect(readFileSync(join(rebuilt.root, "a.txt"), "utf8")).toBe("two\n");
		rmSync(repo, { recursive: true, force: true });
		expect(git(rebuilt.root, "cat-file", "-t", `${checkpoint.ref}^3`)).toBe(
			"commit",
		);
	});

	it("restores a clean HEAD checkpoint", async () => {
		const head = git(repo, "rev-parse", "HEAD");
		writeFileSync(join(repo, "a.txt"), "next\n");
		git(repo, "commit", "--quiet", "-am", "next");
		const rebuilt = await rebuildSessionReplayWorkspace({
			environment: environmentFor({
				ref: head,
				kind: "commit",
				runCount: 1,
				createdAt: 1,
			}),
			parentDir: join(root, "out"),
		});
		expect(rebuilt.checkpoint).toMatchObject({ kind: "commit", base: head });
		expect(readFileSync(join(rebuilt.root, "a.txt"), "utf8")).toBe("one\n");
	});

	it("restores from --workspace when the recorded root is not on this machine", async () => {
		const checkpoint = stashCheckpoint();
		const rebuilt = await rebuildSessionReplayWorkspace({
			environment: environmentFor(checkpoint, {
				workspaceRoot: "/nowhere/proj",
				resolvedWorkspaceRoot: "/nowhere/proj",
			}),
			parentDir: join(root, "out"),
			workspace: repo,
		});
		expect(rebuilt.sourceKind).toBe("override");
		expect(rebuilt.root).toBe(join(root, "out", "proj"));
		expect(readFileSync(join(rebuilt.root, "a.txt"), "utf8")).toBe("two\n");
	});

	it("fails clearly when the recorded workspace is missing", async () => {
		const error = await rebuildSessionReplayWorkspace({
			environment: environmentFor(stashCheckpoint(), {
				resolvedWorkspaceRoot: "/nowhere/proj",
			}),
			parentDir: join(root, "out"),
		}).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(SessionReplayEnvironmentError);
		expect((error as SessionReplayEnvironmentError).code).toBe(
			"workspace-missing",
		);
		expect((error as Error).message).toContain("--workspace <path>");
	});

	it("fails clearly when the workspace path is redacted", async () => {
		const error = await rebuildSessionReplayWorkspace({
			environment: environmentFor(stashCheckpoint(), {
				workspaceRoot: "/home/REDACTED_USER/proj",
				resolvedWorkspaceRoot: undefined,
			}),
			parentDir: join(root, "out"),
		}).catch((caught: unknown) => caught);
		expect((error as SessionReplayEnvironmentError).code).toBe(
			"workspace-redacted",
		);
	});

	it("fails clearly when the checkpoint is not in the repository", async () => {
		const other = join(root, "other");
		mkdirSync(other);
		git(other, "init", "--quiet");
		writeFileSync(join(other, "x.txt"), "x\n");
		git(other, "add", ".");
		git(other, "commit", "--quiet", "-m", "x");
		const error = await rebuildSessionReplayWorkspace({
			environment: environmentFor(stashCheckpoint()),
			parentDir: join(root, "out"),
			workspace: other,
		}).catch((caught: unknown) => caught);
		expect((error as SessionReplayEnvironmentError).code).toBe(
			"checkpoint-missing",
		);
	});

	it("fails when the source is not a git repository", async () => {
		const plain = join(root, "plain");
		mkdirSync(plain);
		const error = await rebuildSessionReplayWorkspace({
			environment: environmentFor(stashCheckpoint()),
			parentDir: join(root, "out"),
			workspace: plain,
		}).catch((caught: unknown) => caught);
		expect((error as SessionReplayEnvironmentError).code).toBe("not-a-repo");
	});

	it("needs --workspace without a checkpoint, then copies it as it is", async () => {
		const error = await rebuildSessionReplayWorkspace({
			environment: environmentFor(undefined),
			parentDir: join(root, "out"),
		}).catch((caught: unknown) => caught);
		expect((error as SessionReplayEnvironmentError).code).toBe("no-checkpoint");

		const rebuilt = await rebuildSessionReplayWorkspace({
			environment: environmentFor(undefined),
			parentDir: join(root, "out"),
			workspace: repo,
		});
		expect(rebuilt.method).toBe("copy");
		expect(readFileSync(join(rebuilt.root, "a.txt"), "utf8")).toBe("one\n");
		expect(rebuilt.warnings[0]).toContain("no starting checkpoint");
	});

	it("refuses to write into a non-empty target", async () => {
		const checkpoint = stashCheckpoint();
		mkdirSync(join(root, "out", "proj"), { recursive: true });
		writeFileSync(join(root, "out", "proj", "keep.txt"), "x");
		const error = await rebuildSessionReplayWorkspace({
			environment: environmentFor(checkpoint),
			parentDir: join(root, "out"),
		}).catch((caught: unknown) => caught);
		expect((error as SessionReplayEnvironmentError).code).toBe("target-exists");
	});

	it("runs in place without restoring, and says when HEAD is elsewhere", async () => {
		const checkpoint = stashCheckpoint();
		writeFileSync(join(repo, "a.txt"), "next\n");
		git(repo, "commit", "--quiet", "-am", "next");
		const rebuilt = await rebuildSessionReplayWorkspace({
			environment: environmentFor(checkpoint),
			parentDir: join(root, "out"),
			inPlace: true,
		});
		expect(rebuilt.method).toBe("in-place");
		expect(rebuilt.root).toBe(repo);
		expect(rebuilt.cwd).toBe(join(repo, "pkg"));
		expect(rebuilt.warnings[0]).toMatch(
			/not at the starting checkpoint's commit/,
		);
		expect(existsSync(join(root, "out"))).toBe(false);
		expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("next\n");
	});
});

describe("session replay path map", () => {
	it("swaps the workspace root both ways and is the identity for one root", () => {
		const map = createSessionReplayPathMap("/w/proj", "/tmp/rerun/proj");
		expect(map.toLive({ path: "/w/proj/a.txt", list: ["/w/proj"] })).toEqual({
			path: "/tmp/rerun/proj/a.txt",
			list: ["/tmp/rerun/proj"],
		});
		expect(map.toRecorded("cd /tmp/rerun/proj && ls")).toBe("cd /w/proj && ls");
		expect(createSessionReplayPathMap("/w/proj", "/w/proj/").identity).toBe(
			true,
		);
	});

	it("maps live session data back to recorded paths and rehashes message blobs", () => {
		const map = createSessionReplayPathMap("/w/proj", "/tmp/rerun/proj");
		const live = mapSessionReplaySessionData(
			{
				transcript: {
					sessionId: "s",
					systemPrompt: "root /tmp/rerun/proj",
					messages: [],
				},
				events: [],
				requests: [],
				blobs: new Map([
					[
						"sha_live",
						{
							sha256: "a".repeat(64),
							kind: "message",
							contentSha256: "b".repeat(64),
							value: { role: "user", content: "read /tmp/rerun/proj/a.txt" },
						},
					],
				]),
			},
			map,
		);
		expect(live.transcript.systemPrompt).toBe("root /w/proj");
		const blob = live.blobs.get("sha_live");
		expect(blob?.value).toEqual({
			role: "user",
			content: "read /w/proj/a.txt",
		});
		expect(blob?.contentSha256).not.toBe("b".repeat(64));
	});
});

describe("compareSessionReplayEnv", () => {
	const recorded = {
		values: { PATH: "/usr/bin", HOME: "/home/REDACTED_USER", TZ: "UTC" },
		sha256: "r",
		redactedKeys: ["HOME"],
	};

	it("is the same when the hashes match", () => {
		expect(
			compareSessionReplayEnv(recorded, { values: {}, sha256: "r" }).same,
		).toBe(true);
	});

	it("lists changed keys and skips redacted ones", () => {
		expect(
			compareSessionReplayEnv(recorded, {
				values: { PATH: "/opt/bin", HOME: "/home/bob", LANG: "C" },
				sha256: "l",
			}),
		).toEqual({
			same: false,
			changed: [
				{ key: "LANG", live: "C" },
				{ key: "PATH", recorded: "/usr/bin", live: "/opt/bin" },
				{ key: "TZ", recorded: "UTC" },
			],
			unknown: ["HOME"],
		});
	});
});
