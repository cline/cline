"use client";

/**
 * The one typed client for every command Factory settings sends: the ones
 * that already exist and the settings commands added with this page. When
 * the sidecar does not know a command, or the Hub behind it is too old
 * (`{ supported: false }`), a call rejects with
 * {@link FactorySettingsUnavailable}, so a page can say so for that group of
 * rows instead of showing a control that does nothing.
 */

import type {
	FactoryRepositoryStage,
	FactoryVerificationProfile,
	FactoryWorkflowConfig,
} from "@cline/shared/browser";
import { HUB_UPGRADE_TIMEOUT_MS } from "@/components/hub-update-required-helpers";
import { desktopClient } from "@/lib/desktop-client";
import type { FactoryLimits } from "@/lib/factory-limits";
import type { FactoryPreset } from "@/lib/factory-presets";

// ---------------------------------------------------------------------------
// Payloads (mirrors of the Hub's `HubFactory*` settings types)

/** Manager readme, routing, then the five roles. */
export type FactoryGuidanceRole =
	| "manager"
	| "factory"
	| "designer"
	| "plan_reviewer"
	| "builder"
	| "verifier"
	| "reviewer";
export type FactoryGuidanceScope = "user" | "repository";

export type FactoryGuidanceScopeState = {
	status: "none" | "current" | "changed" | "invalid";
	content: string;
	/** The `expectedHash` of an edit, accept or discard. */
	hash: string;
	path?: string;
	truncated?: true;
	reason?: string;
	acceptedHash?: string;
	/** The version still in use while a change waits for a decision. */
	acceptedContent?: string;
};

export type FactoryGuidanceRepositoryState = FactoryGuidanceScopeState & {
	accepted: boolean;
	inUse: boolean;
	/** Builder and tester use repository text only once accepted. */
	needsAcceptance: boolean;
};

export type FactoryGuidanceTarget = {
	role: FactoryGuidanceRole;
	user: FactoryGuidanceScopeState;
	repository?: FactoryGuidanceRepositoryState;
};

export type FactoryGuidanceSettings = {
	maxChars: number;
	userScope: boolean;
	managerReadmeDefault: string;
	workspaceRoot?: string;
	targets: FactoryGuidanceTarget[];
};

export type FactoryGuidanceHistoryEntry = {
	id: string;
	time: string;
	role: FactoryGuidanceRole;
	scope: FactoryGuidanceScope;
	workspaceRoot?: string;
	note: string;
	hashBefore: string;
	hashAfter: string;
	before: string;
	after: string;
	/** Absent for Ask Factory. */
	source?:
		| { kind: "feedback"; taskId: string; factoryNumber?: number }
		| { kind: "settings" };
};

export type FactoryGuidanceTargetInput = {
	role: FactoryGuidanceRole;
	scope: FactoryGuidanceScope;
	workspaceRoot?: string;
	expectedHash: string;
};

export type FactoryVerificationStatus =
	| "none"
	| "proposed"
	| "in_use"
	| "changed"
	| "invalid";

export type FactoryVerificationSettings = {
	workspaceRoot: string;
	file: "absent" | "present" | "invalid";
	reason?: string;
	status: FactoryVerificationStatus;
	profile?: FactoryVerificationProfile;
	hash?: string;
	origin?: "repository" | "approved_local" | "proposed";
	approved?: {
		profile: FactoryVerificationProfile;
		hash: string;
		provenAt?: string;
	};
	proposedBy?: { taskId: string; title: string; factoryNumber?: number };
	proposals?: {
		taskId: string;
		title: string;
		factoryNumber?: number;
		hash: string;
		profile: FactoryVerificationProfile;
	}[];
};

export type FactoryStorage = {
	dataDir: string;
	worktreesDir: string;
	artifactsDir: string;
	logsDir: string;
	worktrees: {
		count: number;
		bytes: number;
		finishedCount: number;
		finishedBytes: number;
		unknownCount?: number;
	};
	artifactsBytes: number;
	logsBytes: number;
	approximate?: boolean;
	measuredAt?: string;
	/** Finished working copies are being removed now. */
	cleaning?: true;
};

export type FactoryStorageCleanResult = {
	removed: number;
	bytes: number;
	skipped?: { path: string; reason: string }[];
	storage?: FactoryStorage;
	/** Removal continues in the Hub; the counts are what was done so far. */
	running?: true;
};

export type FactoryResetWhat =
	| "stage_trust"
	| "verification_trust"
	| "user_guidance"
	| "settings";

export type FactoryResetResult = {
	what: FactoryResetWhat;
	dryRun?: boolean;
	stages?: number;
	projects?: number;
	roles?: FactoryGuidanceRole[];
	concurrency?: number;
	dailyCostUsd?: number;
	duplicateCheck?: boolean;
};

export type FactoryProjectSummary = {
	workspaceRoot: string;
	name: string;
	remote?: string;
	defaultBranch?: string;
	cards?: { open: number; archived: number };
	stages: {
		file: "absent" | "present" | "invalid";
		total: number;
		inUse: number;
		awaiting: number;
	};
	verification: FactoryVerificationStatus;
	guidance: { roles: FactoryGuidanceRole[]; changed: FactoryGuidanceRole[] };
	taskFiles: number;
};

export type FactoryProjects = {
	projects: FactoryProjectSummary[];
	/** Your own guidance changed outside Factory, by role. */
	userGuidanceChanged: FactoryGuidanceRole[];
};

export type FactoryConnections = {
	gh: {
		installed: boolean;
		version?: string;
		path?: string;
		hosts: { host: string; login?: string; signedIn: boolean }[];
		/** A probe timed out. */
		error?: string;
	};
	linear: { configured: boolean };
	hub: {
		status: "connected" | "disconnected";
		url?: string;
		appVersion?: string;
		error?: string;
		mismatch?: { hubCoreVersion?: string; reason?: string };
	};
	checkedAt?: string;
};

export type FactoryStageTrust =
	| "approved"
	| "needs_approval"
	| "changed"
	| "declined";

export type FactoryStagesListing = {
	file: "absent" | "present" | "invalid";
	reason?: string;
	path?: string;
	stages: {
		stage: FactoryRepositoryStage;
		hash: string;
		status: FactoryStageTrust;
	}[];
};

export type FactoryProcessContext = {
	appVersion?: string;
	homeDir?: string;
	taskWorktreeRoot?: string;
	hub?: { status: string; url: string | null; error: string | null };
};

export type FactoryProviderCatalog = {
	providers?: {
		id: string;
		name?: string;
		enabled?: boolean;
		configured?: boolean;
		hasCredentials?: boolean;
	}[];
};

export type FactoryMcpServers = {
	servers?: { name: string; disabled?: boolean }[];
};

// ---------------------------------------------------------------------------
// Calls

/** Why a command can't be used: this build lacks it, or its Hub is too old. */
export class FactorySettingsUnavailable extends Error {
	constructor(
		readonly command: string,
		readonly reason: "build" | "hub",
	) {
		super(`${command} is not available`);
		this.name = "FactorySettingsUnavailable";
	}
}

/**
 * A write the backend refused for a reason the person can act on
 * (`{ ok: false, error }`): `code` names it (`factory_guidance_stale`,
 * `factory_verification_invalid`…), `message` is shown under the row, and a
 * stale write carries the `currentHash`.
 */
export class FactorySettingsRefused extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly currentHash?: string,
	) {
		super(message);
		this.name = "FactorySettingsRefused";
	}
}

export const isRefused = (cause: unknown): cause is FactorySettingsRefused =>
	cause instanceof FactorySettingsRefused;

export const isUnavailable = (
	cause: unknown,
): cause is FactorySettingsUnavailable =>
	cause instanceof FactorySettingsUnavailable;

/** The sidecar's reply to a command it does not route. */
const UNKNOWN_COMMAND = /unsupported desktop command|unknown command/i;

async function call<T>(
	command: string,
	args?: object,
	options?: { timeoutMs?: number },
): Promise<T> {
	let result: unknown;
	try {
		const payload = args as Record<string, unknown> | undefined;
		result = await (options
			? desktopClient.invoke<unknown>(command, payload, options)
			: desktopClient.invoke<unknown>(command, payload));
	} catch (cause) {
		if (cause instanceof Error && UNKNOWN_COMMAND.test(cause.message))
			throw new FactorySettingsUnavailable(command, "build");
		throw cause;
	}
	const reply = result as {
		supported?: unknown;
		ok?: unknown;
		error?: { code?: unknown; message?: unknown; currentHash?: unknown };
	} | null;
	if (reply && typeof reply === "object") {
		if (reply.supported === false)
			throw new FactorySettingsUnavailable(command, "hub");
		if (reply.ok === false) {
			const code = String(reply.error?.code ?? "");
			if (code === "factory_settings_unavailable")
				throw new FactorySettingsUnavailable(command, "hub");
			throw new FactorySettingsRefused(
				code,
				typeof reply.error?.message === "string" && reply.error.message
					? reply.error.message
					: "Couldn't save. Try again.",
				typeof reply.error?.currentHash === "string"
					? reply.error.currentHash
					: undefined,
			);
		}
	}
	return result as T;
}

/** A failed call's message for the person. */
export function factorySettingsErrorMessage(
	cause: unknown,
	fallback: string,
): string {
	return cause instanceof Error && cause.message && !isUnavailable(cause)
		? cause.message
		: fallback;
}

export const factorySettingsClient = {
	// Guidance
	getGuidance: (workspaceRoot?: string) =>
		call<FactoryGuidanceSettings>(
			"factory_get_guidance",
			workspaceRoot ? { workspaceRoot } : {},
		),
	getGuidanceHistory: (args: {
		role?: FactoryGuidanceRole;
		workspaceRoot?: string;
		limit?: number;
		before?: string;
	}) =>
		call<{ entries: FactoryGuidanceHistoryEntry[]; more: boolean }>(
			"factory_get_guidance_history",
			args,
		),
	setGuidance: (
		args: FactoryGuidanceTargetInput & { content: string; note?: string },
	) =>
		call<{
			target: FactoryGuidanceTarget;
			entry?: FactoryGuidanceHistoryEntry;
		}>("factory_set_guidance", args),
	resolveGuidance: (
		args: FactoryGuidanceTargetInput & { decision: "accept" | "discard" },
	) =>
		call<{ target: FactoryGuidanceTarget }>("factory_resolve_guidance", args),

	// Test setup
	getVerification: (workspaceRoot: string) =>
		call<FactoryVerificationSettings>("factory_get_verification", {
			workspaceRoot,
		}),
	setVerification: (args: {
		workspaceRoot: string;
		decision: "approve" | "remove";
		expectedHash?: string;
		profile?: FactoryVerificationProfile;
	}) => call<FactoryVerificationSettings>("factory_set_verification", args),

	// Stages
	getStages: (workspaceRoot: string) =>
		call<FactoryStagesListing>("factory_get_stages", { workspaceRoot }),
	decideStage: (args: {
		workspaceRoot: string;
		stageId: string;
		expectedHash: string;
		decision: "approved" | "declined";
	}) => call<FactoryStagesListing>("factory_decide_stage", args),

	// This computer, data and reset
	getStorage: (refresh = false) =>
		call<FactoryStorage>("factory_get_storage", refresh ? { refresh } : {}),
	cleanStorage: () =>
		call<FactoryStorageCleanResult>("factory_clean_storage", {
			what: "finished_worktrees",
		}),
	reset: (args: {
		what: FactoryResetWhat;
		workspaceRoot?: string;
		dryRun?: boolean;
	}) => call<FactoryResetResult>("factory_reset", args),
	getProjects: async (): Promise<FactoryProjects> => {
		const reply = await call<Partial<FactoryProjects> | null>(
			"factory_get_projects",
			{},
		);
		return {
			projects: reply?.projects ?? [],
			userGuidanceChanged: reply?.userGuidanceChanged ?? [],
		};
	},
	getConnections: (refresh = false) =>
		call<FactoryConnections>(
			"factory_get_connections",
			refresh ? { refresh } : {},
		),
	getProcessContext: () => call<FactoryProcessContext>("get_process_context"),
	/** Replaces the Hub; as long as the Hub update dialog allows. */
	upgradeHub: () =>
		call<unknown>("hub_upgrade", undefined, {
			timeoutMs: HUB_UPGRADE_TIMEOUT_MS,
		}),
	/** Restarts the app onto the current Hub (after `upgradeHub`). */
	relaunchApp: () => call<unknown>("relaunch_app"),
	exportDiagnostics: () =>
		call<{ path: string }>("export_diagnostics", { sessionIds: [] }),
	listProviders: () => call<FactoryProviderCatalog>("list_provider_catalog"),
	listMcpServers: () => call<FactoryMcpServers>("list_mcp_servers"),
	openExternalUrl: (url: string) => call<unknown>("open_external_url", { url }),

	// Workflows
	savePreset: (args: {
		name: string;
		config: FactoryWorkflowConfig;
		revision?: string;
		useByDefault?: boolean;
	}) => call<FactoryPreset[]>("factory_save_preset", args),
	/** `newDefault` is required, and only accepted, when deleting the default. */
	deletePreset: (name: string, newDefault?: string) =>
		call<FactoryPreset[]>(
			"factory_delete_preset",
			newDefault ? { name, newDefault } : { name },
		),
	renamePreset: (name: string, newName: string) =>
		call<FactoryPreset[]>("factory_rename_preset", { name, newName }),
	setLimits: (args: {
		concurrency?: number;
		paused?: boolean;
		dailyCostUsd?: number | null;
		duplicateCheck?: boolean;
	}) => call<FactoryLimits>("factory_set_limits", args),
};

export type FactorySettingsClient = typeof factorySettingsClient;
