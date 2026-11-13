import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import {
	type AgendaTaskRecord,
	type AgendaTaskRunRecord,
	factoryCardState,
	factoryVerificationProfileSchema,
	factoryWatchesPullRequest,
	type HubFactoryGuidanceHistoryEntry,
	type HubFactoryGuidanceHistorySource,
	type HubFactoryGuidanceRepositoryState,
	type HubFactoryGuidanceScopeState,
	type HubFactoryGuidanceSettings,
	type HubFactoryGuidanceTarget,
	type HubFactoryProjectSummary,
	type HubFactoryStorageCleanResult,
	type HubFactoryStorageSummary,
	type HubFactoryVerificationProposal,
	type HubFactoryVerificationSettings,
} from "@cline/shared";
import {
	FACTORY_GUIDANCE_MAX_CHARS,
	FACTORY_GUIDANCE_ROLES,
	FACTORY_MANAGER_GUIDANCE_TARGET,
	FACTORY_MANAGER_README_DEFAULT,
	type FactoryGuidanceHistoryEntry,
	type FactoryGuidanceLocation,
	type FactoryGuidanceRead,
	type FactoryGuidanceRole,
	type FactoryGuidanceScope,
	type FactoryGuidanceStore,
	factoryGuidanceBoundsProblem,
	factoryGuidanceRefusal,
	factoryGuidanceSnapshot,
	factoryRepositoryGuidanceNeedsAcceptance,
	screenFactoryGuidance,
} from "./factory-guidance";
import { runFactoryCommand } from "./factory-local";
import { FACTORY_OUTCOME_WATCH_MAX_AGE_DAYS } from "./factory-pull-request";
import {
	createFactoryVerificationProfileSnapshot,
	type FactoryVerificationProfileStore,
	factoryVerificationProfileFindings,
	readFactoryVerificationProfile,
} from "./factory-verification-profile";

/**
 * The engine side of Factory settings: what a person reads and changes in
 * the app's Factory settings (guidance, test setup, working copies, resets).
 * Every write here is a person's explicit click through a trusted client;
 * nothing here is reachable from a model tool.
 */

/** A refusal Factory settings can act on, with a stable code for the client. */
export class FactorySettingsError extends Error {
	constructor(
		readonly code: FactorySettingsErrorCode,
		message: string,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "FactorySettingsError";
	}
}

export type FactorySettingsErrorCode =
	| "factory_settings_unavailable"
	| "factory_settings_unauthorized"
	| "factory_settings_invalid_input"
	| "factory_unknown_project"
	| "factory_guidance_stale"
	| "factory_guidance_refused"
	| "factory_guidance_invalid"
	| "factory_guidance_user_level_only"
	| "factory_guidance_changed_outside"
	| "factory_guidance_unchanged"
	| "factory_guidance_nothing_to_resolve"
	| "factory_verification_stale"
	| "factory_verification_invalid"
	| "factory_verification_repository_file"
	| "factory_reset_invalid";

// ---------------------------------------------------------------------------
// Guidance

/** History entries one settings page reads at most. */
export const FACTORY_GUIDANCE_SETTINGS_HISTORY_MAX = 50;

/** One scope of one guidance target as settings shows it. */
export type FactoryGuidanceSettingsScope = HubFactoryGuidanceScopeState;

export type FactoryGuidanceSettingsRepositoryScope =
	HubFactoryGuidanceRepositoryState;

export type FactoryGuidanceSettingsTarget = HubFactoryGuidanceTarget;

export type FactoryGuidanceSettings = HubFactoryGuidanceSettings;

async function userScopeView(
	store: FactoryGuidanceStore,
	read: FactoryGuidanceRead,
): Promise<FactoryGuidanceSettingsScope> {
	const base = {
		content: read.content,
		hash: read.hash,
		...(read.path ? { path: read.path } : {}),
	};
	switch (read.status) {
		case "absent":
			return { ...base, status: "none" };
		case "invalid":
			return { ...base, status: "invalid", reason: read.reason };
		case "present":
			return {
				...base,
				status: "current",
				...(read.truncated ? { truncated: true as const } : {}),
			};
		case "changed": {
			const accepted = await store.acceptedVersion(read.scope, read.role);
			return {
				...base,
				status: "changed",
				...(read.truncated ? { truncated: true as const } : {}),
				...(accepted ? { acceptedHash: accepted.hash } : {}),
				...(accepted?.content !== undefined
					? { acceptedContent: accepted.content }
					: {}),
			};
		}
	}
}

async function repositoryScopeView(
	store: FactoryGuidanceStore,
	read: FactoryGuidanceRead,
	location: FactoryGuidanceLocation,
): Promise<FactoryGuidanceSettingsRepositoryScope> {
	const needsAcceptance = factoryRepositoryGuidanceNeedsAcceptance(read.role);
	const base = {
		content: read.content,
		hash: read.hash,
		...(read.path ? { path: read.path } : {}),
		needsAcceptance,
	};
	if (read.status === "absent")
		return { ...base, status: "none", accepted: false, inUse: false };
	if (read.status === "invalid")
		return {
			...base,
			status: "invalid",
			reason: read.reason,
			accepted: false,
			inUse: false,
		};
	const accepted = read.status === "present" && read.accepted;
	const inUse =
		factoryGuidanceSnapshot(undefined, read, {
			repositoryNeedsAcceptance: needsAcceptance,
		}).repositoryHash === read.hash;
	const truncated =
		read.status !== "present" || !read.truncated
			? {}
			: { truncated: true as const };
	// Roles that run unattended use repository text only once accepted, so
	// for them a version nobody accepted is "changed outside Factory".
	if (needsAcceptance && !accepted) {
		const version = await store.acceptedVersion(
			"repository",
			read.role,
			location,
		);
		return {
			...base,
			...truncated,
			status: "changed",
			accepted,
			inUse,
			...(version ? { acceptedHash: version.hash } : {}),
			...(version?.content !== undefined
				? { acceptedContent: version.content }
				: {}),
		};
	}
	return { ...base, ...truncated, status: "current", accepted, inUse };
}

/** Every guidance target in both scopes, as settings shows them. Never throws. */
export async function readFactoryGuidanceSettings(
	store: FactoryGuidanceStore,
	workspaceRoot?: string,
	roles: readonly FactoryGuidanceRole[] = FACTORY_GUIDANCE_ROLES,
): Promise<FactoryGuidanceSettings> {
	const location = workspaceRoot ? { workspaceRoot } : {};
	const targets = await Promise.all(
		roles.map(async (role) => ({
			role,
			user: await userScopeView(store, store.read("user", role)),
			...(workspaceRoot && role !== FACTORY_MANAGER_GUIDANCE_TARGET
				? {
						repository: await repositoryScopeView(
							store,
							store.read("repository", role, location),
							location,
						),
					}
				: {}),
		})),
	);
	return {
		maxChars: FACTORY_GUIDANCE_MAX_CHARS,
		userScope: store.hasUserScope,
		managerReadmeDefault: FACTORY_MANAGER_README_DEFAULT,
		...(workspaceRoot ? { workspaceRoot } : {}),
		targets,
	};
}

/** A history entry as settings lists it, newest first. */
export type FactoryGuidanceSettingsHistoryEntry =
	HubFactoryGuidanceHistoryEntry;

function historyId(entry: FactoryGuidanceHistoryEntry): string {
	return `${entry.time}#${entry.scope}#${entry.role}#${entry.hashAfter}`;
}

function historySource(
	source: unknown,
	factoryNumberOf?: (taskId: string) => number | undefined,
): HubFactoryGuidanceHistorySource | undefined {
	const value = source as { kind?: unknown; taskId?: unknown } | undefined;
	if (value?.kind === "settings") return { kind: "settings" };
	if (value?.kind === "feedback" && typeof value.taskId === "string") {
		const factoryNumber = factoryNumberOf?.(value.taskId);
		return {
			kind: "feedback",
			taskId: value.taskId,
			...(factoryNumber ? { factoryNumber } : {}),
		};
	}
	return undefined;
}

/**
 * One page of guidance history, newest first: one target (or all) in both
 * scopes; repository entries only for `workspaceRoot`. `before` is the `id`
 * of the last entry of the previous page.
 */
export async function readFactoryGuidanceHistory(
	store: FactoryGuidanceStore,
	input: {
		role?: FactoryGuidanceRole;
		workspaceRoot?: string;
		limit: number;
		before?: string;
	},
	/** The card's F-number for a feedback source, so settings can name it. */
	factoryNumberOf?: (taskId: string) => number | undefined,
): Promise<{ entries: FactoryGuidanceSettingsHistoryEntry[]; more: boolean }> {
	const workspace = input.workspaceRoot
		? path.resolve(input.workspaceRoot)
		: undefined;
	const all = (await store.history({ role: input.role }))
		.filter(
			(entry) =>
				entry.scope === "user" ||
				(workspace !== undefined && entry.workspaceRoot === workspace),
		)
		.reverse();
	let start = 0;
	if (input.before) {
		const index = all.findIndex((entry) => historyId(entry) === input.before);
		if (index >= 0) start = index + 1;
		else {
			// The entry rotated out: continue from the first older one.
			const time = input.before.split("#")[0] ?? "";
			const next = all.findIndex((entry) => entry.time < time);
			start = next < 0 ? all.length : next;
		}
	}
	const limit = Math.min(
		Math.max(1, Math.trunc(input.limit)),
		FACTORY_GUIDANCE_SETTINGS_HISTORY_MAX,
	);
	const page = all.slice(start, start + limit);
	return {
		entries: page.map((entry) => {
			const source = historySource(entry.source, factoryNumberOf);
			return {
				id: historyId(entry),
				time: entry.time,
				role: entry.role,
				scope: entry.scope,
				...(entry.workspaceRoot ? { workspaceRoot: entry.workspaceRoot } : {}),
				note: entry.note.slice(0, 200),
				hashBefore: entry.hashBefore,
				hashAfter: entry.hashAfter,
				before: entry.before.slice(0, FACTORY_GUIDANCE_MAX_CHARS),
				after: entry.after.slice(0, FACTORY_GUIDANCE_MAX_CHARS),
				...(source ? { source } : {}),
			};
		}),
		more: start + limit < all.length,
	};
}

export interface FactoryGuidanceSettingsTargetInput {
	role: FactoryGuidanceRole;
	scope: FactoryGuidanceScope;
	/** Required for the repository scope; a project Factory knows. */
	workspaceRoot?: string;
}

function guidanceLocation(
	store: FactoryGuidanceStore,
	input: FactoryGuidanceSettingsTargetInput,
): FactoryGuidanceLocation {
	if (
		input.role === FACTORY_MANAGER_GUIDANCE_TARGET &&
		input.scope === "repository"
	)
		throw new FactorySettingsError(
			"factory_guidance_user_level_only",
			"The manager readme is user-level only, because the manager's own instructions must not come from a repository.",
		);
	if (input.scope === "user") {
		if (!store.hasUserScope)
			throw new FactorySettingsError(
				"factory_settings_unavailable",
				"User-level guidance is unavailable in this Hub.",
			);
		return {};
	}
	if (!input.workspaceRoot)
		throw new FactorySettingsError(
			"factory_guidance_invalid",
			"Repository guidance needs the project.",
		);
	return { workspaceRoot: input.workspaceRoot };
}

function staleGuidance(currentHash: string): FactorySettingsError {
	return new FactorySettingsError(
		"factory_guidance_stale",
		"This guidance changed while you were editing. Reload it, then make your change again.",
		{ currentHash },
	);
}

function refusedGuidance(role: FactoryGuidanceRole, screened: string) {
	return new FactorySettingsError(
		"factory_guidance_refused",
		`${factoryGuidanceRefusal(role)} (This text would ${screened}.)`,
	);
}

async function targetAfter(
	store: FactoryGuidanceStore,
	input: FactoryGuidanceSettingsTargetInput,
): Promise<FactoryGuidanceSettingsTarget> {
	const settings = await readFactoryGuidanceSettings(
		store,
		input.workspaceRoot,
		[input.role],
	);
	return settings.targets[0] as FactoryGuidanceSettingsTarget;
}

/**
 * A person's direct edit from Factory settings: the full new text of one
 * target in one scope, written only when the file still has `expectedHash`.
 * Same bounds and refusal screens as the manager's confirmed changes, the
 * same store path (atomic write, accepted hash recorded, so a settings save
 * never reads as "changed outside Factory"), and a history entry with source
 * `settings`. Empty text removes the file; its history keeps it restorable.
 */
export async function setFactoryGuidanceFromSettings(
	store: FactoryGuidanceStore,
	input: FactoryGuidanceSettingsTargetInput & {
		expectedHash: string;
		content: string;
		note?: string;
	},
): Promise<{
	target: FactoryGuidanceSettingsTarget;
	entry: FactoryGuidanceSettingsHistoryEntry;
}> {
	const location = guidanceLocation(store, input);
	const content = input.content.replace(/\r\n?/g, "\n");
	const problem = factoryGuidanceBoundsProblem(content);
	if (problem)
		throw new FactorySettingsError("factory_guidance_invalid", problem);
	const screened = screenFactoryGuidance(content, input.role);
	if (screened) throw refusedGuidance(input.role, screened);
	const current = store.read(input.scope, input.role, location);
	if (current.status === "invalid")
		throw new FactorySettingsError(
			"factory_guidance_invalid",
			`The current guidance cannot be changed here: ${current.reason}.`,
		);
	if (current.hash !== input.expectedHash) throw staleGuidance(current.hash);
	if (current.status === "changed")
		throw new FactorySettingsError(
			"factory_guidance_changed_outside",
			"This file was changed outside Factory. Accept or discard that change first.",
		);
	if (current.status === "present" && current.truncated)
		throw new FactorySettingsError(
			"factory_guidance_invalid",
			`The current guidance is over the ${FACTORY_GUIDANCE_MAX_CHARS.toLocaleString("en-US")} character limit; shorten ${current.path} by hand first.`,
		);
	if ((content.trim() ? content : "") === current.content)
		throw new FactorySettingsError(
			"factory_guidance_unchanged",
			"That leaves the guidance as it is.",
		);
	let entry: FactoryGuidanceHistoryEntry;
	try {
		entry = await store.apply(
			input.scope,
			input.role,
			input.expectedHash,
			content,
			input.note?.trim() || "Edited in Factory settings",
			location,
			{ kind: "settings" },
		);
	} catch (error) {
		// A write that raced this one since the read above.
		const now = store.read(input.scope, input.role, location);
		if (now.hash !== input.expectedHash) throw staleGuidance(now.hash);
		throw error;
	}
	const listed = await readFactoryGuidanceHistory(store, {
		role: input.role,
		workspaceRoot: input.workspaceRoot,
		limit: 1,
	});
	return {
		target: await targetAfter(store, input),
		entry: listed.entries[0] ?? {
			id: historyId(entry),
			...entry,
			source: { kind: "settings" },
		},
	};
}

/**
 * Accepts or discards a guidance file changed outside Factory, exactly the
 * version whose hash is `expectedHash`. Accepting screens the file like the
 * manager's accept; discarding restores the version Factory last applied
 * (no file when none was). Both go through the store and its history.
 */
export async function resolveFactoryGuidanceFromSettings(
	store: FactoryGuidanceStore,
	input: FactoryGuidanceSettingsTargetInput & {
		decision: "accept" | "discard";
		expectedHash: string;
	},
): Promise<{ target: FactoryGuidanceSettingsTarget }> {
	const location = guidanceLocation(store, input);
	const current = store.read(input.scope, input.role, location);
	const unresolved =
		current.status === "changed" ||
		(input.scope === "repository" &&
			current.status === "present" &&
			!current.accepted);
	if (!unresolved)
		throw new FactorySettingsError(
			"factory_guidance_nothing_to_resolve",
			"This guidance has no change from outside Factory to accept or discard.",
		);
	if (current.hash !== input.expectedHash) throw staleGuidance(current.hash);
	let proposal: Awaited<ReturnType<FactoryGuidanceStore["proposeAccept"]>>;
	try {
		proposal =
			input.decision === "accept"
				? await store.proposeAccept(input.scope, input.role, location)
				: await store.proposeDiscard(input.scope, input.role, location);
	} catch (error) {
		throw new FactorySettingsError(
			"factory_guidance_invalid",
			error instanceof Error ? error.message : String(error),
		);
	}
	if (proposal.baseHash !== input.expectedHash)
		throw staleGuidance(proposal.baseHash);
	if (input.decision === "accept") {
		const screened = screenFactoryGuidance(proposal.content, input.role);
		if (screened) throw refusedGuidance(input.role, screened);
	}
	try {
		await store.apply(
			input.scope,
			input.role,
			proposal.baseHash,
			proposal.content,
			`${proposal.summary} (in Factory settings)`,
			location,
			{ kind: "settings" },
		);
	} catch (error) {
		const now = store.read(input.scope, input.role, location);
		if (now.hash !== input.expectedHash) throw staleGuidance(now.hash);
		throw error;
	}
	return { target: await targetAfter(store, input) };
}

/**
 * Clears the person's own guidance for every target, through the store so
 * each removal is in the history and can be restored. Repository files are
 * never touched. With `dryRun`, only counts.
 */
export async function clearFactoryUserGuidance(
	store: FactoryGuidanceStore,
	dryRun: boolean,
): Promise<{ roles: FactoryGuidanceRole[] }> {
	if (!store.hasUserScope) return { roles: [] };
	const roles: FactoryGuidanceRole[] = [];
	for (const role of FACTORY_GUIDANCE_ROLES) {
		const read = store.read("user", role);
		if (read.status !== "present" && read.status !== "changed") continue;
		roles.push(role);
		if (!dryRun)
			await store.apply(
				"user",
				role,
				read.hash,
				"",
				"Cleared in Factory settings",
				{},
				{ kind: "settings" },
			);
	}
	return { roles };
}

// ---------------------------------------------------------------------------
// Test setup (verification profile)

/** A card whose plan proposes a test setup this project has not approved. */
export type FactoryVerificationProposal = HubFactoryVerificationProposal;

/** A project's test setup as settings shows it (see the Hub type). */
export type FactoryVerificationSettings = HubFactoryVerificationSettings;

const VERIFICATION_PROPOSALS_MAX = 5;

/** Cards in the project whose frozen plan proposes a setup, newest first. */
export function factoryVerificationProposals(
	tasks: readonly AgendaTaskRecord[],
	workspaceRoot: string,
	approvedHash?: string,
): FactoryVerificationProposal[] {
	const root = path.resolve(workspaceRoot);
	const seen = new Set<string>();
	return tasks
		.filter(
			(task) =>
				!task.archivedAt &&
				task.workspaceRoot !== undefined &&
				path.resolve(task.workspaceRoot) === root &&
				task.factory?.verificationProfile?.origin === "proposed" &&
				task.factory.verificationProfile.hash !== approvedHash &&
				["pending_approval", "approved", "in_progress"].includes(task.status),
		)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		.flatMap((task) => {
			const proposal = task.factory?.verificationProfile;
			if (!proposal || seen.has(proposal.hash)) return [];
			seen.add(proposal.hash);
			return [
				{
					taskId: task.taskId,
					title: task.title.slice(0, 200),
					...(task.factoryNumber ? { factoryNumber: task.factoryNumber } : {}),
					hash: proposal.hash,
					profile: proposal.profile,
				},
			];
		})
		.slice(0, VERIFICATION_PROPOSALS_MAX);
}

/** The project's test setup with its trust status. Never throws for a missing project. */
export async function readFactoryVerificationSettings(
	store: FactoryVerificationProfileStore,
	workspaceRoot: string,
	proposals: FactoryVerificationProposal[] = [],
): Promise<FactoryVerificationSettings> {
	const file = readFactoryVerificationProfile(workspaceRoot);
	const stored = await store.get(workspaceRoot).catch(() => undefined);
	const approved = stored
		? {
				profile: stored.profile,
				hash: stored.hash,
				...(stored.provenAt ? { provenAt: stored.provenAt } : {}),
			}
		: undefined;
	const base = {
		workspaceRoot,
		file: file.status,
		...(file.status === "invalid" ? { reason: file.reason } : {}),
		...(approved ? { approved } : {}),
		proposals,
	};
	if (file.status === "present") {
		if (stored?.hash === file.hash)
			return {
				...base,
				status: "in_use",
				origin: "repository",
				profile: file.profile,
				hash: file.hash,
			};
		const proposer = proposals.find((item) => item.hash === file.hash);
		return {
			...base,
			status: stored ? "changed" : "proposed",
			origin: "proposed",
			profile: file.profile,
			hash: file.hash,
			...(proposer
				? {
						proposedBy: {
							taskId: proposer.taskId,
							title: proposer.title,
							...(proposer.factoryNumber
								? { factoryNumber: proposer.factoryNumber }
								: {}),
						},
					}
				: {}),
		};
	}
	if (file.status === "invalid") return { ...base, status: "invalid" };
	if (stored)
		return {
			...base,
			status: "in_use",
			origin: "approved_local",
			profile: stored.profile,
			hash: stored.hash,
		};
	const proposal = proposals[0];
	if (proposal)
		return {
			...base,
			status: "proposed",
			origin: "proposed",
			profile: proposal.profile,
			hash: proposal.hash,
			proposedBy: {
				taskId: proposal.taskId,
				title: proposal.title,
				...(proposal.factoryNumber
					? { factoryNumber: proposal.factoryNumber }
					: {}),
			},
		};
	return { ...base, status: "none" };
}

function staleVerification(currentHash?: string): FactorySettingsError {
	return new FactorySettingsError(
		"factory_verification_stale",
		"The test setup changed since it was shown. Review it again.",
		currentHash ? { currentHash } : undefined,
	);
}

/**
 * A person's decision on a project's test setup. `approve` with
 * `expectedHash`: the shown file or card proposal, exactly that hash.
 * `approve` with `profile`: saves a setup approved on this computer
 * (refused while the repository has its own file; `expectedHash`, when
 * given, is the approved copy being replaced). `remove`: stop using the
 * approval (`expectedHash`, when given, must be the approved hash).
 */
export async function setFactoryVerificationSettings(
	store: FactoryVerificationProfileStore,
	input: {
		workspaceRoot: string;
		decision: "approve" | "remove";
		expectedHash?: string;
		profile?: unknown;
	},
	proposals: FactoryVerificationProposal[] = [],
): Promise<FactoryVerificationSettings> {
	const current = await readFactoryVerificationSettings(
		store,
		input.workspaceRoot,
		proposals,
	);
	if (input.decision === "remove") {
		if (input.expectedHash && input.expectedHash !== current.approved?.hash)
			throw staleVerification(current.approved?.hash);
		await store.remove(input.workspaceRoot);
	} else if (input.profile !== undefined) {
		if (current.file !== "absent")
			throw new FactorySettingsError(
				"factory_verification_repository_file",
				"This project has its own .cline/factory/verification.json, so its test setup comes from that file. Change the file instead, then approve it here.",
			);
		if (input.expectedHash && input.expectedHash !== current.approved?.hash)
			throw staleVerification(current.approved?.hash);
		const parsed = factoryVerificationProfileSchema.safeParse(input.profile);
		const findings = parsed.success
			? factoryVerificationProfileFindings(parsed.data, {
					sourceRoot: input.workspaceRoot,
				})
			: factoryVerificationProfileFindings(input.profile);
		if (!parsed.success || findings.length)
			throw new FactorySettingsError(
				"factory_verification_invalid",
				findings.join(" ").slice(0, 2_000) || "The test setup is not valid.",
			);
		await store.approve(
			input.workspaceRoot,
			createFactoryVerificationProfileSnapshot(parsed.data).profile,
		);
	} else {
		if (!input.expectedHash) throw staleVerification(current.hash);
		const candidate =
			current.file === "present" && current.hash === input.expectedHash
				? current.profile
				: current.file === "absent"
					? proposals.find((item) => item.hash === input.expectedHash)?.profile
					: undefined;
		if (!candidate) throw staleVerification(current.hash);
		const findings = factoryVerificationProfileFindings(candidate, {
			sourceRoot: input.workspaceRoot,
		});
		if (findings.length)
			throw new FactorySettingsError(
				"factory_verification_invalid",
				findings.join(" ").slice(0, 2_000),
			);
		await store.approve(input.workspaceRoot, candidate);
	}
	return readFactoryVerificationSettings(
		store,
		input.workspaceRoot,
		proposals.filter((item) => item.hash !== input.expectedHash),
	);
}

// ---------------------------------------------------------------------------
// Working copies

/**
 * Whether a card's working copies may be removed by "Remove finished
 * copies". Only a card that can no longer run and needs nothing from them:
 *
 * - not working now (no live run, scoping or PR follow-up) and not queued;
 * - closed: completed, cancelled or expired (never pending, approved,
 *   in progress or stopped, which can still run or be tried again);
 * - no PR follow-up pending, and no draft PR still open that Factory
 *   follows (a watched PR, even paused, can resume; an unwatched one is
 *   polled for its outcome for FACTORY_OUTCOME_WATCH_MAX_AGE_DAYS);
 * - no unpublished work: a card meant to open a PR has one;
 * - unless archived, nothing waits on the person (a review stamp, a
 *   proposed rule).
 *
 * Removal itself (`git worktree remove`, never forced) also refuses a copy
 * with uncommitted changes. The card's branch and evidence are kept.
 */
export function factoryWorktreeRemovable(input: {
	task: AgendaTaskRecord;
	lastRun?: AgendaTaskRunRecord;
	/** A run, scoping session or PR follow-up is live for the card. */
	live: boolean;
	now?: number;
}): { removable: boolean; reason: string } {
	const { task, lastRun } = input;
	const no = (reason: string) => ({ removable: false, reason });
	if (input.live) return no("working");
	if (task.factoryQueued) return no("queued");
	if (
		task.status !== "completed" &&
		task.status !== "cancelled" &&
		task.status !== "expired"
	)
		return no("can still run");
	const state = lastRun?.factory;
	if (state?.pullRequestWatch?.pending) return no("PR follow-up pending");
	if (state?.pullRequestUrl && !state.pullRequestOutcome) {
		if (factoryWatchesPullRequest(task.factory))
			return no("draft PR open and followed up");
		const completedAt = Date.parse(lastRun?.completedAt ?? "");
		if (
			!Number.isFinite(completedAt) ||
			completedAt >=
				(input.now ?? Date.now()) -
					FACTORY_OUTCOME_WATCH_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
		)
			return no("draft PR open and watched");
	}
	if (
		task.status === "completed" &&
		task.factory?.publishPullRequest &&
		!state?.pullRequestUrl
	)
		return no("unpublished work");
	if (
		!task.archivedAt &&
		factoryCardState({ task, lastRun }).waitingOn === "person"
	)
		return no("waits for you");
	return { removable: true, reason: "finished" };
}

/** The entry budget of one storage measurement; past it sizes are approximate. */
export const FACTORY_STORAGE_MEASURE_MAX_ENTRIES = 200_000;

/**
 * Bytes under `root` (files only, symlinks not followed), counting at most
 * `budget.left` entries. Never throws; a missing path is 0.
 */
export async function factoryDirectoryBytes(
	root: string,
	budget: { left: number; capped: boolean },
): Promise<number> {
	let bytes = 0;
	const stack = [root];
	while (stack.length) {
		const current = stack.pop() as string;
		if (budget.left <= 0) {
			budget.capped = true;
			break;
		}
		budget.left--;
		let entry: Awaited<ReturnType<typeof lstat>>;
		try {
			entry = await lstat(current);
		} catch {
			continue;
		}
		if (entry.isDirectory()) {
			try {
				for (const name of await readdir(current))
					stack.push(path.join(current, name));
			} catch {
				// Unreadable directories count as empty.
			}
		} else if (entry.isFile()) bytes += entry.size;
	}
	return bytes;
}

export const FACTORY_WORKTREES_DIR_NAME = "factory-worktrees";
export const FACTORY_ARTIFACTS_DIR_NAME = "factory-artifacts";
export const FACTORY_APP_LOGS_DIR_NAME = "factory-app-logs";

/** One card working copy under the worktrees folder. */
export interface FactoryWorktreeEntry {
	/** `<worktreesDir>/<id>/repo`. */
	path: string;
	bytes: number;
	/** The card it belongs to; absent when no card records it. */
	taskId?: string;
	removable: boolean;
	/** Why it is or is not removable ("finished", "working", "unknown card"). */
	reason: string;
}

/** Where Factory keeps its data on this computer, and how much. */
export type FactoryStorageSummary = HubFactoryStorageSummary;

/**
 * Lists and sizes the card working copies, evidence and app logs. Sizes walk
 * the folders within FACTORY_STORAGE_MEASURE_MAX_ENTRIES entries. `owner`
 * says which card a copy belongs to and whether it may be removed.
 */
export async function measureFactoryStorage(input: {
	dataDir: string;
	storageDir: string;
	owner: (
		repoPath: string,
	) => { taskId: string; removable: boolean; reason: string } | undefined;
	now?: () => Date;
}): Promise<{
	summary: FactoryStorageSummary;
	worktrees: FactoryWorktreeEntry[];
}> {
	const worktreesDir = path.join(input.storageDir, FACTORY_WORKTREES_DIR_NAME);
	const artifactsDir = path.join(input.storageDir, FACTORY_ARTIFACTS_DIR_NAME);
	const logsDir = path.join(input.storageDir, FACTORY_APP_LOGS_DIR_NAME);
	const budget = {
		left: FACTORY_STORAGE_MEASURE_MAX_ENTRIES,
		capped: false,
	};
	let ids: string[] = [];
	try {
		ids = (await readdir(worktreesDir)).sort();
	} catch {
		ids = [];
	}
	const worktrees: FactoryWorktreeEntry[] = [];
	for (const id of ids) {
		const repo = path.join(worktreesDir, id, "repo");
		try {
			if (!(await lstat(repo)).isDirectory()) continue;
		} catch {
			continue;
		}
		const owner = input.owner(repo);
		worktrees.push({
			path: repo,
			bytes: await factoryDirectoryBytes(repo, budget),
			...(owner ? { taskId: owner.taskId } : {}),
			removable: owner?.removable ?? false,
			reason: owner?.reason ?? "unknown card",
		});
	}
	const finished = worktrees.filter((entry) => entry.removable);
	const sum = (entries: FactoryWorktreeEntry[]) =>
		entries.reduce((total, entry) => total + entry.bytes, 0);
	const artifactsBytes = await factoryDirectoryBytes(artifactsDir, budget);
	const logsBytes = await factoryDirectoryBytes(logsDir, budget);
	return {
		worktrees,
		summary: {
			dataDir: input.dataDir,
			worktreesDir,
			artifactsDir,
			logsDir,
			worktrees: {
				count: worktrees.length,
				bytes: sum(worktrees),
				finishedCount: finished.length,
				finishedBytes: sum(finished),
				unknownCount: worktrees.filter((entry) => !entry.taskId).length,
			},
			artifactsBytes,
			logsBytes,
			approximate: budget.capped,
			measuredAt: (input.now?.() ?? new Date()).toISOString(),
		},
	};
}

/** What "Remove finished copies" did. */
export type FactoryStorageCleanResult = Omit<
	HubFactoryStorageCleanResult,
	"storage"
>;

/**
 * Removes the removable working copies with `git worktree remove` (never
 * forced, so one with uncommitted changes stays), from the card's project.
 * `recheck` re-reads the card right before each removal. Only paths of the
 * shape `<worktreesDir>/<id>/repo` are ever touched; the card's branch, the
 * `workspace.json` beside the copy (so a restored card can recreate it) and
 * evidence are kept.
 */
export async function cleanFactoryWorktrees(input: {
	worktreesDir: string;
	worktrees: FactoryWorktreeEntry[];
	recheck: (entry: FactoryWorktreeEntry) => {
		removable: boolean;
		reason: string;
		sourceRoot?: string;
	};
	removeWorktree?: (
		sourceRoot: string,
		repoPath: string,
	) => Promise<{ ok: boolean }>;
	/** Filled in as copies are removed, for a caller that replies before the end. */
	progress?: FactoryStorageCleanResult;
}): Promise<FactoryStorageCleanResult> {
	const remove =
		input.removeWorktree ??
		(async (sourceRoot: string, repoPath: string) => {
			const result = await runFactoryCommand({
				cwd: sourceRoot,
				file: "git",
				args: ["worktree", "remove", repoPath],
				timeoutMs: 120_000,
			});
			return { ok: result.exitCode === 0 };
		});
	const root = path.resolve(input.worktreesDir);
	const result: FactoryStorageCleanResult = input.progress ?? {
		removed: 0,
		bytes: 0,
		skipped: [],
	};
	const skip = (entry: FactoryWorktreeEntry, reason: string) => {
		if (result.skipped.length < 100)
			result.skipped.push({ path: entry.path, reason });
	};
	for (const entry of input.worktrees) {
		if (!entry.removable) continue;
		const repo = path.resolve(entry.path);
		if (
			path.basename(repo) !== "repo" ||
			path.dirname(path.dirname(repo)) !== root
		) {
			skip(entry, "not a Factory working copy");
			continue;
		}
		const now = input.recheck(entry);
		if (!now.removable) {
			skip(entry, now.reason);
			continue;
		}
		if (!now.sourceRoot) {
			skip(entry, "the project folder is missing");
			continue;
		}
		const removed = await remove(now.sourceRoot, repo).catch(() => ({
			ok: false,
		}));
		let gone = false;
		try {
			await lstat(repo);
		} catch {
			gone = true;
		}
		if (removed.ok && gone) {
			result.removed++;
			result.bytes += entry.bytes;
		} else skip(entry, "it has uncommitted changes or git could not remove it");
	}
	return result;
}

/** A remote URL without any user name, password or token in it. */
export function factoryRemoteWithoutCredentials(url: string): string {
	const trimmed = url.trim().slice(0, 500);
	return trimmed.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1");
}

/** One project as the settings Projects list shows it. */
export type FactoryProjectSummary = HubFactoryProjectSummary;

export const FACTORY_TASK_FILES_COUNT_MAX = 10_000;

/** Counts `.cline/tasks/*.task.md` in a project without reading them. */
export async function countFactoryTaskFiles(
	workspaceRoot: string,
): Promise<number> {
	try {
		const names = await readdir(path.join(workspaceRoot, ".cline", "tasks"));
		return Math.min(
			names.filter((name) => name.endsWith(".task.md")).length,
			FACTORY_TASK_FILES_COUNT_MAX,
		);
	} catch {
		return 0;
	}
}

/** origin's URL (credentials removed) and default branch; each undefined when unknown. */
export async function readFactoryProjectRemote(
	workspaceRoot: string,
): Promise<{ remote?: string; defaultBranch?: string }> {
	const git = async (args: string[]) => {
		try {
			const result = await runFactoryCommand({
				cwd: workspaceRoot,
				file: "git",
				args,
				timeoutMs: 5_000,
				maxBytes: 2_000,
				captureStdout: true,
			});
			return result.exitCode === 0
				? (result.stdout ?? "").trim() || undefined
				: undefined;
		} catch {
			return undefined;
		}
	};
	const [remote, head] = await Promise.all([
		git(["config", "--get", "remote.origin.url"]),
		git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]),
	]);
	return {
		...(remote ? { remote: factoryRemoteWithoutCredentials(remote) } : {}),
		...(head?.startsWith("origin/")
			? { defaultBranch: head.slice("origin/".length) }
			: {}),
	};
}

/** Short project names: the folder, with its parent when two share it. */
export function factoryProjectNames(
	roots: readonly string[],
): Map<string, string> {
	const shared = new Set(
		roots
			.map((root) => path.basename(root))
			.filter((name, index, names) => names.indexOf(name) !== index),
	);
	return new Map(
		roots.map((root) => {
			const name = path.basename(root);
			return [
				root,
				shared.has(name)
					? `${path.basename(path.dirname(root))}/${name}`
					: name,
			];
		}),
	);
}

/** A project's repository guidance roles, and those changed outside Factory. */
export function factoryProjectGuidance(
	store: FactoryGuidanceStore | undefined,
	workspaceRoot: string,
): FactoryProjectSummary["guidance"] {
	const roles: FactoryGuidanceRole[] = [];
	const changed: FactoryGuidanceRole[] = [];
	if (!store) return { roles, changed };
	for (const role of FACTORY_GUIDANCE_ROLES) {
		if (role === FACTORY_MANAGER_GUIDANCE_TARGET) continue;
		const read = store.read("repository", role, { workspaceRoot });
		if (read.status !== "present") continue;
		roles.push(role);
		if (factoryRepositoryGuidanceNeedsAcceptance(role) && !read.accepted)
			changed.push(role);
	}
	return { roles, changed };
}
