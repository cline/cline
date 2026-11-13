import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgendaTaskRecord, AgendaTaskRunRecord } from "@cline/shared";
import {
	factoryTaskConfigSchema,
	factoryWatchesPullRequest,
} from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { adoptFactoryPolicy } from "./agenda-task-manager";
import {
	FACTORY_GUIDANCE_EMPTY_HASH,
	FACTORY_MANAGER_README_DEFAULT,
	FactoryGuidanceStore,
	factoryGuidanceHash,
} from "./factory-guidance";
import {
	cleanFactoryWorktrees,
	clearFactoryUserGuidance,
	FactorySettingsError,
	factoryRemoteWithoutCredentials,
	factoryWorktreeRemovable,
	measureFactoryStorage,
	readFactoryGuidanceHistory,
	readFactoryGuidanceSettings,
	readFactoryVerificationSettings,
	resolveFactoryGuidanceFromSettings,
	setFactoryGuidanceFromSettings,
	setFactoryVerificationSettings,
} from "./factory-settings";
import { FileFactoryStageTrustStore } from "./factory-stages";
import {
	FileFactoryVerificationProfileStore,
	factoryVerificationProfileHash,
} from "./factory-verification-profile";
import { createFactoryWorkflowRecipe } from "./factory-workflow-recipe";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix = "cline-factory-settings-"): string {
	const root = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
	roots.push(root);
	return root;
}

function guidanceSetup() {
	const root = tempRoot();
	const repo = join(root, "repo");
	mkdirSync(repo);
	return {
		root,
		repo,
		userDir: join(root, "data", "factory-guidance"),
		store: new FactoryGuidanceStore(join(root, "data", "factory-guidance")),
	};
}

async function refusal(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		if (error instanceof FactorySettingsError) return error;
		throw error;
	}
	throw new Error("expected a refusal");
}

describe("guidance from Factory settings", () => {
	it("saves a person's edit through the store, records its source and never reads as changed outside Factory", async () => {
		const { store } = guidanceSetup();
		const text = "## Tests\nEvery change comes with a test.\n";
		const saved = await setFactoryGuidanceFromSettings(store, {
			role: "reviewer",
			scope: "user",
			expectedHash: FACTORY_GUIDANCE_EMPTY_HASH,
			content: text,
		});
		expect(saved.target.user).toMatchObject({
			status: "current",
			content: text,
			hash: factoryGuidanceHash(text),
		});
		expect(saved.entry).toMatchObject({
			role: "reviewer",
			scope: "user",
			note: "Edited in Factory settings",
			hashBefore: FACTORY_GUIDANCE_EMPTY_HASH,
			hashAfter: factoryGuidanceHash(text),
			source: { kind: "settings" },
		});
		// Roles use it: it is the accepted version.
		expect(store.read("user", "reviewer").status).toBe("present");
		expect(store.promptBlock("reviewer")).toContain("Every change");

		// A stale hash is refused with the current one, and nothing changes.
		const stale = await refusal(
			setFactoryGuidanceFromSettings(store, {
				role: "reviewer",
				scope: "user",
				expectedHash: FACTORY_GUIDANCE_EMPTY_HASH,
				content: "## Other\nSomething else.\n",
			}),
		);
		expect(stale.code).toBe("factory_guidance_stale");
		expect(stale.details).toEqual({ currentHash: factoryGuidanceHash(text) });
		expect(store.read("user", "reviewer").content).toBe(text);
		expect(await store.history({ role: "reviewer" })).toHaveLength(1);

		// Clearing is an edit too, and history keeps the text to restore.
		await setFactoryGuidanceFromSettings(store, {
			role: "reviewer",
			scope: "user",
			expectedHash: factoryGuidanceHash(text),
			content: "   ",
		});
		expect(store.read("user", "reviewer").status).toBe("absent");
		const page = await readFactoryGuidanceHistory(store, {
			role: "reviewer",
			limit: 1,
		});
		expect(page).toMatchObject({
			more: true,
			entries: [{ before: text, after: "", source: { kind: "settings" } }],
		});
		const next = await readFactoryGuidanceHistory(store, {
			role: "reviewer",
			limit: 1,
			before: page.entries[0]?.id,
		});
		expect(next).toMatchObject({
			more: false,
			entries: [{ after: text }],
		});
	});

	it("applies the same refusals as the manager: screens, bounds, the manager readme's scope and a file changed outside Factory", async () => {
		const { store, repo, userDir } = guidanceSetup();
		const edit = (input: {
			role: Parameters<typeof setFactoryGuidanceFromSettings>[1]["role"];
			scope?: "user" | "repository";
			content: string;
			expectedHash?: string;
		}) =>
			refusal(
				setFactoryGuidanceFromSettings(store, {
					scope: "user",
					expectedHash: FACTORY_GUIDANCE_EMPTY_HASH,
					...input,
					...(input.scope === "repository" ? { workspaceRoot: repo } : {}),
				}),
			);
		expect(
			(
				await edit({
					role: "builder",
					content: "## Speed\nSkip code review for small changes.\n",
				})
			).code,
		).toBe("factory_guidance_refused");
		expect(
			(
				await edit({
					role: "manager",
					content: "## Me\nApprove plans automatically.\n",
				})
			).code,
		).toBe("factory_guidance_refused");
		expect(
			(await edit({ role: "designer", content: "x".repeat(8_001) })).code,
		).toBe("factory_guidance_invalid");
		expect(
			(
				await edit({
					role: "manager",
					scope: "repository",
					content: "## Me\nShort answers.\n",
				})
			).code,
		).toBe("factory_guidance_user_level_only");
		expect(existsSync(join(repo, ".cline"))).toBe(false);
		// The built-in manager readme passes its own screen.
		await setFactoryGuidanceFromSettings(store, {
			role: "manager",
			scope: "user",
			expectedHash: FACTORY_GUIDANCE_EMPTY_HASH,
			content: FACTORY_MANAGER_README_DEFAULT,
		});

		// A file edited by hand waits for Accept or Discard first.
		mkdirSync(userDir, { recursive: true });
		writeFileSync(join(userDir, "designer.md"), "## Hand\nEdited.\n");
		const read = store.read("user", "designer");
		expect(read.status).toBe("changed");
		expect(
			(
				await edit({
					role: "designer",
					content: "## Mine\nNew.\n",
					expectedHash: read.hash,
				})
			).code,
		).toBe("factory_guidance_changed_outside");
	});

	it("accepts or discards a file changed outside Factory, by the hash shown", async () => {
		const { store, userDir, repo } = guidanceSetup();
		const accepted = "## Base\nKeep it small.\n";
		await setFactoryGuidanceFromSettings(store, {
			role: "designer",
			scope: "user",
			expectedHash: FACTORY_GUIDANCE_EMPTY_HASH,
			content: accepted,
		});
		const handEdit = "## Base\nKeep it small.\n\n## Hand\nAdded by hand.\n";
		writeFileSync(join(userDir, "designer.md"), handEdit);

		const settings = await readFactoryGuidanceSettings(store, repo);
		const designer = settings.targets.find(
			(target) => target.role === "designer",
		);
		expect(designer?.user).toMatchObject({
			status: "changed",
			content: handEdit,
			acceptedHash: factoryGuidanceHash(accepted),
			acceptedContent: accepted,
		});
		expect(
			settings.targets.find((target) => target.role === "manager"),
		).not.toHaveProperty("repository");

		expect(
			(
				await refusal(
					resolveFactoryGuidanceFromSettings(store, {
						role: "designer",
						scope: "user",
						decision: "accept",
						expectedHash: factoryGuidanceHash(accepted),
					}),
				)
			).code,
		).toBe("factory_guidance_stale");
		await expect(
			resolveFactoryGuidanceFromSettings(store, {
				role: "designer",
				scope: "user",
				decision: "accept",
				expectedHash: factoryGuidanceHash(handEdit),
			}),
		).resolves.toMatchObject({
			target: { user: { status: "current", content: handEdit } },
		});
		expect(
			(
				await refusal(
					resolveFactoryGuidanceFromSettings(store, {
						role: "designer",
						scope: "user",
						decision: "discard",
						expectedHash: factoryGuidanceHash(handEdit),
					}),
				)
			).code,
		).toBe("factory_guidance_nothing_to_resolve");

		// Discard puts back the version Factory last applied.
		writeFileSync(join(userDir, "designer.md"), "## Other\nChanged again.\n");
		await resolveFactoryGuidanceFromSettings(store, {
			role: "designer",
			scope: "user",
			decision: "discard",
			expectedHash: factoryGuidanceHash("## Other\nChanged again.\n"),
		});
		expect(store.read("user", "designer")).toMatchObject({
			status: "present",
			content: handEdit,
		});

		// Repository builder text nobody accepted is "changed" and not in use
		// until accepted from settings.
		mkdirSync(join(repo, ".cline/factory/guidance"), { recursive: true });
		const repoText = "## Repo\nRun the linter.\n";
		writeFileSync(join(repo, ".cline/factory/guidance/builder.md"), repoText);
		const before = (
			await readFactoryGuidanceSettings(store, repo)
		).targets.find((target) => target.role === "builder");
		expect(before?.repository).toMatchObject({
			status: "changed",
			accepted: false,
			inUse: false,
			needsAcceptance: true,
		});
		const after = await resolveFactoryGuidanceFromSettings(store, {
			role: "builder",
			scope: "repository",
			workspaceRoot: repo,
			decision: "accept",
			expectedHash: factoryGuidanceHash(repoText),
		});
		expect(after.target.repository).toMatchObject({
			status: "current",
			accepted: true,
			inUse: true,
		});
		expect((await store.history({ role: "builder" })).at(-1)?.source).toEqual({
			kind: "settings",
		});
	});

	it("clears only your guidance, keeping history so each can be restored", async () => {
		const { store, repo } = guidanceSetup();
		for (const role of ["designer", "reviewer"] as const)
			await setFactoryGuidanceFromSettings(store, {
				role,
				scope: "user",
				expectedHash: FACTORY_GUIDANCE_EMPTY_HASH,
				content: `## ${role}\nText.\n`,
			});
		mkdirSync(join(repo, ".cline/factory/guidance"), { recursive: true });
		writeFileSync(
			join(repo, ".cline/factory/guidance/designer.md"),
			"## R\nx\n",
		);
		await expect(clearFactoryUserGuidance(store, true)).resolves.toEqual({
			roles: ["designer", "reviewer"],
		});
		expect(store.read("user", "designer").status).toBe("present");
		await expect(clearFactoryUserGuidance(store, false)).resolves.toEqual({
			roles: ["designer", "reviewer"],
		});
		expect(store.read("user", "designer").status).toBe("absent");
		expect(
			store.read("repository", "designer", { workspaceRoot: repo }).status,
		).toBe("present");
		const history = await store.history({ role: "designer" });
		expect(history.at(-1)).toMatchObject({
			after: "",
			before: "## designer\nText.\n",
			source: { kind: "settings" },
		});
	});
});

const profile = {
	schemaVersion: 1 as const,
	environment: { start: "bun run dev", readyTimeoutSeconds: 120 },
	exercise: "Open the home page and sign in.",
	artifacts: [],
};
const otherProfile = {
	schemaVersion: 1 as const,
	environment: { setup: "bun install", start: "bun run start" },
	exercise: "Open the settings page.",
	artifacts: [],
};

describe("test setup from Factory settings", () => {
	it("approves exactly the shown file, refuses a stale hash and reports a changed file", async () => {
		const repo = tempRoot();
		const store = new FileFactoryVerificationProfileStore();
		await expect(
			readFactoryVerificationSettings(store, repo),
		).resolves.toMatchObject({ file: "absent", status: "none", proposals: [] });

		mkdirSync(join(repo, ".cline/factory"), { recursive: true });
		const file = join(repo, ".cline/factory/verification.json");
		writeFileSync(file, JSON.stringify(profile));
		const hash = factoryVerificationProfileHash(profile);
		await expect(
			readFactoryVerificationSettings(store, repo),
		).resolves.toMatchObject({
			file: "present",
			status: "proposed",
			origin: "proposed",
			hash,
		});
		expect(
			(
				await refusal(
					setFactoryVerificationSettings(store, {
						workspaceRoot: repo,
						decision: "approve",
						expectedHash: "0".repeat(64),
					}),
				)
			).code,
		).toBe("factory_verification_stale");
		await expect(store.get(repo)).resolves.toBeUndefined();
		await expect(
			setFactoryVerificationSettings(store, {
				workspaceRoot: repo,
				decision: "approve",
				expectedHash: hash,
			}),
		).resolves.toMatchObject({
			status: "in_use",
			origin: "repository",
			approved: { hash },
		});

		// The file changes: nothing runs until the person decides.
		writeFileSync(file, JSON.stringify(otherProfile));
		await expect(
			readFactoryVerificationSettings(store, repo),
		).resolves.toMatchObject({
			status: "changed",
			hash: factoryVerificationProfileHash(otherProfile),
			approved: { hash },
		});
		// A local setup cannot be saved over the repository's file.
		expect(
			(
				await refusal(
					setFactoryVerificationSettings(store, {
						workspaceRoot: repo,
						decision: "approve",
						profile,
					}),
				)
			).code,
		).toBe("factory_verification_repository_file");
		await expect(
			setFactoryVerificationSettings(store, {
				workspaceRoot: repo,
				decision: "remove",
				expectedHash: hash,
			}),
		).resolves.toMatchObject({ status: "proposed" });
		await expect(store.get(repo)).resolves.toBeUndefined();
	});

	it("saves a setup approved on this computer, refusing unsafe commands, and approves a card's proposal by hash", async () => {
		const repo = tempRoot();
		const store = new FileFactoryVerificationProfileStore();
		expect(
			(
				await refusal(
					setFactoryVerificationSettings(store, {
						workspaceRoot: repo,
						decision: "approve",
						profile: {
							...profile,
							environment: { start: "sudo bun run dev" },
						},
					}),
				)
			).code,
		).toBe("factory_verification_invalid");
		await expect(
			setFactoryVerificationSettings(store, {
				workspaceRoot: repo,
				decision: "approve",
				profile,
			}),
		).resolves.toMatchObject({
			status: "in_use",
			origin: "approved_local",
			hash: factoryVerificationProfileHash(profile),
		});
		await setFactoryVerificationSettings(store, {
			workspaceRoot: repo,
			decision: "remove",
		});

		const proposal = {
			taskId: "task_1",
			title: "Add login",
			factoryNumber: 7,
			hash: factoryVerificationProfileHash(otherProfile),
			profile: otherProfile,
		};
		await expect(
			readFactoryVerificationSettings(store, repo, [proposal]),
		).resolves.toMatchObject({
			status: "proposed",
			hash: proposal.hash,
			proposedBy: { taskId: "task_1", title: "Add login", factoryNumber: 7 },
		});
		await expect(
			setFactoryVerificationSettings(
				store,
				{
					workspaceRoot: repo,
					decision: "approve",
					expectedHash: proposal.hash,
				},
				[proposal],
			),
		).resolves.toMatchObject({ status: "in_use", origin: "approved_local" });
	});
});

const NOW = Date.parse("2026-11-12T12:00:00.000Z");

function card(overrides: Partial<AgendaTaskRecord> = {}): AgendaTaskRecord {
	return {
		taskId: "task_1",
		type: "feature",
		status: "completed",
		title: "Feature",
		instructions: "Build it",
		scope: "workspace",
		workspaceRoot: "/repo",
		resourcePaths: [],
		priority: 2,
		availableAt: "2026-11-01T00:00:00.000Z",
		expiresAt: "2026-12-01T00:00:00.000Z",
		automationEligible: false,
		revision: 2,
		approvedRevision: 2,
		createdBy: { kind: "user" },
		updatedBy: { kind: "user" },
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		factory: factoryTaskConfigSchema.parse({
			autonomy: "hands_off",
			publishPullRequest: true,
		}),
		...overrides,
	} as AgendaTaskRecord;
}

function lastRun(
	factory: Record<string, unknown>,
	completedAt = "2026-11-01T00:00:00.000Z",
): AgendaTaskRunRecord {
	return {
		runId: "run_1",
		taskId: "task_1",
		taskRevision: 2,
		attempt: 1,
		status: "completed",
		claimedAt: completedAt,
		completedAt,
		createdAt: completedAt,
		updatedAt: completedAt,
		factory: {
			phase: "ready",
			repairRound: 0,
			checks: [],
			sessions: [],
			workspace: {
				path: "/w/repo",
				branch: "factory/f-1",
				baseBranch: "main",
				baseCommit: "a".repeat(40),
			},
			humanApproval: { approvedAt: completedAt },
			...factory,
		},
	} as unknown as AgendaTaskRunRecord;
}

describe("which working copies can be removed", () => {
	const PR = "https://github.com/o/r/pull/1";
	const cases: Array<
		[string, Parameters<typeof factoryWorktreeRemovable>[0], boolean, string]
	> = [
		[
			"a card working now",
			{ task: card(), lastRun: lastRun({}), live: true },
			false,
			"working",
		],
		[
			"a queued card",
			{
				task: card({ factoryQueued: "run" }),
				lastRun: lastRun({}),
				live: false,
			},
			false,
			"queued",
		],
		...(["pending_approval", "approved", "in_progress", "failed"] as const).map(
			(status) =>
				[
					`a ${status} card`,
					{ task: card({ status }), lastRun: lastRun({}), live: false },
					false,
					"can still run",
				] as [
					string,
					Parameters<typeof factoryWorktreeRemovable>[0],
					boolean,
					string,
				],
		),
		[
			"an open PR Factory keeps passing (hands-off default)",
			{
				task: card(),
				lastRun: lastRun({ phase: "watching", pullRequestUrl: PR }),
				live: false,
			},
			false,
			"draft PR open and followed up",
		],
		[
			"an archived card whose PR follow-up is only paused",
			{
				task: card({ archivedAt: "2026-11-02T00:00:00.000Z" }),
				lastRun: lastRun({
					pullRequestUrl: PR,
					pullRequestWatch: { paused: true, handledFeedbackIds: [] },
				}),
				live: false,
			},
			false,
			"draft PR open and followed up",
		],
		[
			"an unwatched open PR still polled for its outcome",
			{
				task: card({
					factory: factoryTaskConfigSchema.parse({
						autonomy: "hands_off",
						publishPullRequest: true,
						watchPullRequest: false,
					}),
				}),
				lastRun: lastRun({ pullRequestUrl: PR }, "2026-11-10T00:00:00.000Z"),
				live: false,
				now: NOW,
			},
			false,
			"draft PR open and watched",
		],
		[
			"work meant for a PR that never opened",
			{ task: card(), lastRun: lastRun({}), live: false },
			false,
			"unpublished work",
		],
		[
			"a merged PR",
			{
				task: card(),
				lastRun: lastRun({
					pullRequestUrl: PR,
					pullRequestOutcome: {
						state: "merged",
						at: "2026-11-03T00:00:00.000Z",
					},
				}),
				live: false,
			},
			true,
			"finished",
		],
		[
			"an unwatched PR past its outcome window",
			{
				task: card({
					factory: factoryTaskConfigSchema.parse({
						autonomy: "hands_off",
						publishPullRequest: true,
						watchPullRequest: false,
					}),
				}),
				lastRun: lastRun({ pullRequestUrl: PR }, "2026-10-01T00:00:00.000Z"),
				live: false,
				now: NOW,
			},
			true,
			"finished",
		],
		[
			"a delivered branch",
			{
				task: card({
					factory: factoryTaskConfigSchema.parse({ publishPullRequest: false }),
				}),
				lastRun: lastRun({}),
				live: false,
			},
			true,
			"finished",
		],
		[
			"a cancelled card",
			{ task: card({ status: "cancelled" }), live: false },
			true,
			"finished",
		],
	];
	it.each(cases)("%s", (_label, input, removable, reason) => {
		expect(factoryWorktreeRemovable(input)).toEqual({ removable, reason });
	});

	it("keeps a delivered card waiting for the person's review stamp unless archived", () => {
		const run = lastRun({
			pullRequestUrl: "https://github.com/o/r/pull/2",
			pullRequestOutcome: { state: "closed", at: "2026-11-03T00:00:00.000Z" },
			humanApproval: undefined,
			humanReview: { required: true, reason: "Large change" },
			audit: {
				finding: "Off",
				analysis: { status: "proposed", trigger: "feedback", startedAt: "x" },
			},
		});
		expect(
			factoryWorktreeRemovable({ task: card(), lastRun: run, live: false }),
		).toEqual({ removable: false, reason: "waits for you" });
		expect(
			factoryWorktreeRemovable({
				task: card({ archivedAt: "2026-11-04T00:00:00.000Z" }),
				lastRun: run,
				live: false,
			}),
		).toEqual({ removable: true, reason: "finished" });
	});
});

function git(cwd: string, ...args: string[]) {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

describe("removing finished working copies", () => {
	it("removes only removable copies, never a dirty one, one that became active or a path outside the folder", async () => {
		const root = tempRoot();
		const repo = join(root, "project");
		mkdirSync(repo);
		git(repo, "init", "-q", "-b", "main");
		git(repo, "config", "user.name", "Test");
		git(repo, "config", "user.email", "test@example.com");
		writeFileSync(join(repo, "README.md"), "hello\n");
		git(repo, "add", ".");
		git(repo, "commit", "-q", "-m", "init");
		const storageDir = join(root, "data", "factory");
		const worktreesDir = join(storageDir, "factory-worktrees");
		const add = (id: string) => {
			const path = join(worktreesDir, id, "repo");
			mkdirSync(join(worktreesDir, id), { recursive: true });
			writeFileSync(join(worktreesDir, id, "workspace.json"), "{}");
			git(repo, "worktree", "add", "-q", "-b", `factory/${id}`, path);
			return path;
		};
		const done = add("done");
		const dirty = add("dirty");
		const active = add("active");
		const becameActive = add("later");
		writeFileSync(join(dirty, "scratch.txt"), "unsaved\n");
		const owners: Record<string, { taskId: string; removable: boolean }> = {
			[done]: { taskId: "t_done", removable: true },
			[dirty]: { taskId: "t_dirty", removable: true },
			[active]: { taskId: "t_active", removable: false },
			[becameActive]: { taskId: "t_later", removable: true },
		};
		const measured = await measureFactoryStorage({
			dataDir: join(root, "data"),
			storageDir,
			owner: (path) => {
				const owner = owners[path];
				return owner
					? { ...owner, reason: owner.removable ? "finished" : "working" }
					: undefined;
			},
		});
		expect(measured.summary.worktrees).toMatchObject({
			count: 4,
			finishedCount: 3,
			unknownCount: 0,
		});
		expect(measured.summary.worktrees.bytes).toBeGreaterThan(0);
		const result = await cleanFactoryWorktrees({
			worktreesDir,
			worktrees: [
				...measured.worktrees,
				// Never a path outside the worktrees folder, even if marked removable.
				{
					path: repo,
					bytes: 1,
					taskId: "x",
					removable: true,
					reason: "finished",
				},
			],
			recheck: (entry) =>
				entry.taskId === "t_later"
					? { removable: false, reason: "working" }
					: { removable: true, reason: "finished", sourceRoot: repo },
		});
		expect(result.removed).toBe(1);
		expect(result.bytes).toBe(
			measured.worktrees.find((entry) => entry.path === done)?.bytes,
		);
		expect(existsSync(done)).toBe(false);
		// The card's branch and the manifest beside the copy stay.
		expect(git(repo, "branch", "--list", "factory/done").trim()).toContain(
			"factory/done",
		);
		expect(existsSync(join(worktreesDir, "done", "workspace.json"))).toBe(true);
		for (const kept of [dirty, active, becameActive, repo])
			expect(existsSync(kept)).toBe(true);
		expect(result.skipped).toEqual(
			expect.arrayContaining([
				{ path: dirty, reason: expect.stringContaining("uncommitted") },
				{ path: becameActive, reason: "working" },
				{ path: repo, reason: "not a Factory working copy" },
			]),
		);
	});
});

describe("forgetting approvals", () => {
	it("forgets stage decisions in one project or all, counting first with dryRun", async () => {
		const path = join(tempRoot(), "stage-trust.json");
		const store = new FileFactoryStageTrustStore(path);
		const hash = "a".repeat(64);
		await store.decide("/a", "lint", hash, "approved");
		await store.decide("/a", "scan", hash, "declined");
		await store.decide("/b", "lint", hash, "approved");
		await expect(store.forget(undefined, true)).resolves.toEqual({
			stages: 3,
			projects: 2,
		});
		await expect(store.get("/a")).resolves.toHaveProperty("lint");
		await expect(store.forget("/a")).resolves.toEqual({
			stages: 2,
			projects: 1,
		});
		await expect(store.get("/a")).resolves.toEqual({});
		await expect(store.get("/b")).resolves.toHaveProperty("lint");
		await expect(store.forget()).resolves.toEqual({ stages: 1, projects: 1 });
		expect(existsSync(path)).toBe(false);
	});

	it("forgets test setup approvals in one project or all", async () => {
		const store = new FileFactoryVerificationProfileStore(
			join(tempRoot(), "profiles.json"),
		);
		await store.approve("/a", profile);
		await store.approve("/b", otherProfile);
		await expect(store.forget("/a", true)).resolves.toEqual({ projects: 1 });
		await expect(store.forget("/a")).resolves.toEqual({ projects: 1 });
		await expect(store.get("/a")).resolves.toBeUndefined();
		await expect(store.get("/b")).resolves.toBeDefined();
		await expect(store.forget()).resolves.toEqual({ projects: 1 });
		await expect(store.get("/b")).resolves.toBeUndefined();
	});
});

describe("project summary helpers", () => {
	it("never returns credentials in a remote URL", () => {
		expect(
			factoryRemoteWithoutCredentials(
				"https://x-access-token:ghs_secret@github.com/o/r.git",
			),
		).toBe("https://github.com/o/r.git");
		expect(factoryRemoteWithoutCredentials("git@github.com:o/r.git")).toBe(
			"git@github.com:o/r.git",
		);
	});
});

describe("Keep the PR passing as a workflow setting", () => {
	it("has one default, keeps revisions stable and is copied to new cards that set none", () => {
		const handsOff = { autonomy: "hands_off", approval: "automatic" };
		const plain = createFactoryWorkflowRecipe({
			name: "Hands-off",
			config: handsOff,
		});
		// Saying the default out loud moves no revision; turning it off does.
		expect(
			createFactoryWorkflowRecipe({
				name: "Hands-off",
				config: { ...handsOff, watchPullRequest: true },
			}).revision,
		).toBe(plain.revision);
		const off = createFactoryWorkflowRecipe({
			name: "Hands-off",
			config: { ...handsOff, watchPullRequest: false },
		});
		expect(off.revision).not.toBe(plain.revision);
		expect(off.config.watchPullRequest).toBe(false);

		const task = card({
			status: "pending_approval",
			createdBy: { kind: "user" },
		});
		const bare = factoryTaskConfigSchema.parse({});
		const at = "2026-11-12T00:00:00.000Z";
		expect(adoptFactoryPolicy(task, bare, off, at).watchPullRequest).toBe(
			false,
		);
		// The card's own choice wins over the workflow's.
		expect(
			adoptFactoryPolicy(
				task,
				factoryTaskConfigSchema.parse({ watchPullRequest: true }),
				off,
				at,
			).watchPullRequest,
		).toBe(true);
		// No workflow value: unset, read through the one default.
		const adopted = adoptFactoryPolicy(task, bare, plain, at);
		expect(adopted.watchPullRequest).toBeUndefined();
		expect(factoryWatchesPullRequest(adopted)).toBe(true);
	});
});
