import { DEFAULT_PLANNER_CALLS_PER_HOUR } from "../config";
import { readJsonFile } from "../store/data-dir";
import { isRecord } from "../values";

/** The settings file's schema version; a file with another version is read as defaults. */
const SETTINGS_VERSION = 1;

/**
 * What a connector may do for Next Turn: nothing, be named as a
 * capability, have bounded facts read in the background, or receive "Needs
 * you" items.
 */
export const CONNECTOR_ROLES = ["off", "mention", "read", "notify"] as const;
export type ConnectorRole = (typeof CONNECTOR_ROLES)[number];

/**
 * A read the person pinned on an MCP server or a Composio toolkit: one read-only tool with fixed arguments. Its id is the scope id that
 * turns it on.
 */
export type PinnedRead = {
	id: string;
	tool: string;
	arguments: Record<string, unknown>;
	label?: string;
};

type ConnectorSetting = {
	role: ConnectorRole;
	scopes: string[];
	reads?: PinnedRead[];
};

type PlannerModel =
	| { kind: "chat" }
	| { kind: "model"; providerId: string; modelId: string };

export type Settings = {
	features: { next: boolean; tasks: boolean; status: boolean };
	context: {
		tasks: boolean;
		status: boolean;
		history: boolean;
		clineSetup: boolean;
		repo: boolean;
	};
	connectors: Record<string, ConnectorSetting>;
	planner: { model: PlannerModel; callsPerHour: number };
	notify: { needsYou: boolean };
};

type WorkspaceOverride = {
	features?: Partial<Settings["features"]>;
	context?: Partial<Settings["context"]>;
	connectors?: Record<string, ConnectorSetting>;
	notify?: Partial<Settings["notify"]>;
};

/** The file on disk: settings for everywhere, plus overrides by workspace root. */
export type SettingsFile = {
	version: typeof SETTINGS_VERSION;
	everywhere: Settings;
	workspaces: Record<string, WorkspaceOverride>;
};

export function defaultSettings(): Settings {
	return {
		features: { next: true, tasks: true, status: true },
		context: {
			tasks: true,
			status: true,
			history: true,
			clineSetup: true,
			repo: true,
		},
		connectors: {},
		planner: {
			model: { kind: "chat" },
			callsPerHour: DEFAULT_PLANNER_CALLS_PER_HOUR,
		},
		notify: { needsYou: true },
	};
}

export function defaultSettingsFile(): SettingsFile {
	return {
		version: SETTINGS_VERSION,
		everywhere: defaultSettings(),
		workspaces: {},
	};
}

function partialFlags<T extends Record<string, boolean>>(
	raw: unknown,
	base: T,
): Partial<T> {
	const out: Partial<T> = {};
	if (!isRecord(raw)) return out;
	for (const key of Object.keys(base) as Array<keyof T>) {
		const value = raw[key as string];
		if (typeof value === "boolean") out[key] = value as T[keyof T];
	}
	return out;
}

function flags<T extends Record<string, boolean>>(raw: unknown, base: T): T {
	return { ...base, ...partialFlags(raw, base) };
}

function connectorSetting(raw: unknown): ConnectorSetting | undefined {
	if (!isRecord(raw)) return undefined;
	const role = CONNECTOR_ROLES.find((candidate) => candidate === raw.role);
	if (!role) return undefined;
	const scopes = Array.isArray(raw.scopes)
		? raw.scopes.filter((scope): scope is string => typeof scope === "string")
		: [];
	const reads = pinnedReads(raw.reads);
	return {
		role,
		scopes: [...new Set(scopes)],
		...(reads.length > 0 ? { reads } : {}),
	};
}

function pinnedReads(raw: unknown): PinnedRead[] {
	if (!Array.isArray(raw)) return [];
	const reads: PinnedRead[] = [];
	for (const entry of raw) {
		if (
			!isRecord(entry) ||
			typeof entry.id !== "string" ||
			!entry.id ||
			typeof entry.tool !== "string" ||
			!entry.tool
		)
			continue;
		if (reads.some((read) => read.id === entry.id)) continue;
		reads.push({
			id: entry.id,
			tool: entry.tool,
			arguments: isRecord(entry.arguments) ? entry.arguments : {},
			...(typeof entry.label === "string" && entry.label.trim()
				? { label: entry.label.trim() }
				: {}),
		});
	}
	return reads;
}

function connectors(raw: unknown): Record<string, ConnectorSetting> {
	const out: Record<string, ConnectorSetting> = {};
	if (!isRecord(raw)) return out;
	for (const [id, value] of Object.entries(raw)) {
		const setting = connectorSetting(value);
		if (setting && id.length > 0) out[id] = setting;
	}
	return out;
}

function plannerModel(raw: unknown): PlannerModel {
	if (
		isRecord(raw) &&
		raw.kind === "model" &&
		typeof raw.providerId === "string" &&
		typeof raw.modelId === "string"
	) {
		return { kind: "model", providerId: raw.providerId, modelId: raw.modelId };
	}
	return { kind: "chat" };
}

function positiveInt(raw: unknown, fallback: number): number {
	return typeof raw === "number" && Number.isInteger(raw) && raw > 0
		? raw
		: fallback;
}

function settings(raw: unknown): Settings {
	const base = defaultSettings();
	if (!isRecord(raw)) return base;
	const planner = isRecord(raw.planner) ? raw.planner : {};
	return {
		features: flags(raw.features, base.features),
		context: flags(raw.context, base.context),
		connectors: connectors(raw.connectors),
		planner: {
			model: plannerModel(planner.model),
			callsPerHour: positiveInt(
				planner.callsPerHour,
				base.planner.callsPerHour,
			),
		},
		notify: flags(raw.notify, base.notify),
	};
}

function workspaceOverride(raw: unknown): WorkspaceOverride | undefined {
	if (!isRecord(raw)) return undefined;
	const base = defaultSettings();
	const override: WorkspaceOverride = {};
	const features = partialFlags(raw.features, base.features);
	const context = partialFlags(raw.context, base.context);
	const notify = partialFlags(raw.notify, base.notify);
	const connectorOverrides = connectors(raw.connectors);
	if (Object.keys(features).length > 0) override.features = features;
	if (Object.keys(context).length > 0) override.context = context;
	if (Object.keys(notify).length > 0) override.notify = notify;
	if (Object.keys(connectorOverrides).length > 0)
		override.connectors = connectorOverrides;
	return Object.keys(override).length > 0 ? override : undefined;
}

/**
 * Read whatever is on disk leniently: an unknown key is dropped, a wrong type
 * falls back to its default, and a file from another schema version reads as
 * defaults rather than failing the plugin.
 */
export function parseSettingsFile(raw: unknown): SettingsFile {
	if (!isRecord(raw) || raw.version !== SETTINGS_VERSION)
		return defaultSettingsFile();
	const workspaces: Record<string, WorkspaceOverride> = {};
	if (isRecord(raw.workspaces)) {
		for (const [root, value] of Object.entries(raw.workspaces)) {
			const override = workspaceOverride(value);
			if (override && root.length > 0) workspaces[root] = override;
		}
	}
	return {
		version: SETTINGS_VERSION,
		everywhere: settings(raw.everywhere),
		workspaces,
	};
}

/** The settings in force for one workspace: everywhere, then that workspace's overrides. */
export function effectiveSettings(
	file: SettingsFile,
	workspaceRoot?: string,
): Settings {
	const base = file.everywhere;
	const override = workspaceRoot ? file.workspaces[workspaceRoot] : undefined;
	if (!override) return base;
	return {
		features: { ...base.features, ...override.features },
		context: { ...base.context, ...override.context },
		connectors: { ...base.connectors, ...override.connectors },
		planner: base.planner,
		notify: { ...base.notify, ...override.notify },
	};
}

export function loadSettingsFile(path: string): SettingsFile {
	return parseSettingsFile(readJsonFile(path));
}
