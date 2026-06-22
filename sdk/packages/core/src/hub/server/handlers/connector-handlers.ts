import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
	ActiveConnectorRecord,
	ConfiguredConnectorRecord,
	ConnectorChannelsResponse,
	ConnectorFieldDef,
	HubCommandEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import {
	CONNECTOR_PLATFORMS,
	connectorChannelsFromPlatforms,
	listConnectorCatalog,
	shouldIncludeConnectorField,
} from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import { errorReply, okReply } from "./context";

type ConnectorSettingsEntry = {
	type: string;
	values: Record<string, string>;
	security?: {
		enabled: boolean;
		values: Record<string, string>;
	};
	configuredAt: string;
	updatedAt: string;
};

type ConnectorSettingsFile = {
	version: 1;
	connectors: Record<string, ConnectorSettingsEntry>;
};

type ConnectorFieldKey = keyof Omit<
	ActiveConnectorRecord,
	"id" | "type" | "pid" | "hubUrl"
>;

const CONNECTOR_SETTINGS_VERSION = 1;

const connectorFieldExtractors: Record<
	ConnectorFieldKey,
	(p: Record<string, unknown>) => string | number | undefined
> = {
	startedAt: (p) => (typeof p.startedAt === "string" ? p.startedAt : undefined),
	port: (p) => (typeof p.port === "number" ? p.port : undefined),
	baseUrl: (p) => (typeof p.baseUrl === "string" ? p.baseUrl : undefined),
	connectionMode: (p) =>
		typeof p.connectionMode === "string" ? p.connectionMode : undefined,
	userName: (p) => (typeof p.userName === "string" ? p.userName : undefined),
	botUsername: (p) =>
		typeof p.botUsername === "string" ? p.botUsername : undefined,
	applicationId: (p) =>
		typeof p.applicationId === "string" ? p.applicationId : undefined,
	phoneNumberId: (p) =>
		typeof p.phoneNumberId === "string" ? p.phoneNumberId : undefined,
};

const connectorActiveStateConfigs: Record<
	string,
	{ required: ConnectorFieldKey[]; optional: ConnectorFieldKey[] }
> = {
	discord: {
		required: ["userName", "applicationId"],
		optional: ["startedAt", "port", "baseUrl"],
	},
	telegram: { required: ["botUsername"], optional: ["startedAt"] },
	gchat: { required: ["userName"], optional: ["startedAt", "port", "baseUrl"] },
	linear: {
		required: ["userName"],
		optional: ["startedAt", "port", "baseUrl"],
	},
	slack: {
		required: ["userName"],
		optional: ["startedAt", "connectionMode", "port", "baseUrl"],
	},
	whatsapp: {
		required: ["userName"],
		optional: ["startedAt", "phoneNumberId", "port", "baseUrl"],
	},
};

function resolveConnectorSettingsPath(): string {
	return join(resolveClineDataDir(), "connectors", "settings.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value.trim() : undefined;
}

function readJsonRecord(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function readConnectorSettings(): ConnectorSettingsFile {
	const parsed = readJsonRecord(resolveConnectorSettingsPath());
	const connectors = isRecord(parsed?.connectors) ? parsed.connectors : {};
	const normalized: Record<string, ConnectorSettingsEntry> = {};
	for (const [id, value] of Object.entries(connectors)) {
		if (!isRecord(value)) {
			continue;
		}
		const type = asString(value.type);
		const configuredAt = asString(value.configuredAt);
		const updatedAt = asString(value.updatedAt);
		if (!type || !configuredAt || !updatedAt) {
			continue;
		}
		const values = normalizeStringRecord(value.values);
		const security = isRecord(value.security)
			? {
					enabled: value.security.enabled === true,
					values: normalizeStringRecord(value.security.values),
				}
			: undefined;
		normalized[id] = { type, values, security, configuredAt, updatedAt };
	}
	return { version: CONNECTOR_SETTINGS_VERSION, connectors: normalized };
}

function writeConnectorSettings(settings: ConnectorSettingsFile): void {
	const path = resolveConnectorSettingsPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function normalizeStringRecord(value: unknown): Record<string, string> {
	if (!isRecord(value)) {
		return {};
	}
	const entries: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw === "string") {
			entries[key] = raw.trim();
		}
	}
	return entries;
}

function isProcessRunning(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function listConnectorStatePaths(type: string): string[] {
	const dir = join(resolveClineDataDir(), "connectors", type);
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".threads.json"))
		.map((name) => join(dir, name));
}

function connectorRecordId(
	type: string,
	fields: Partial<
		Omit<ActiveConnectorRecord, "id" | "type" | "pid" | "hubUrl">
	>,
	pid: number,
): string {
	const identity =
		fields.botUsername ??
		fields.userName ??
		fields.applicationId ??
		fields.phoneNumberId ??
		String(pid);
	return `${type}:${identity}`;
}

function readActiveConnectorRecord(
	type: string,
	statePath: string,
): ActiveConnectorRecord | undefined {
	const parsed = readJsonRecord(statePath);
	if (!parsed) {
		return undefined;
	}
	const pid = typeof parsed.pid === "number" ? parsed.pid : undefined;
	const hubUrl =
		typeof parsed.hubUrl === "string"
			? parsed.hubUrl
			: typeof parsed.rpcAddress === "string"
				? parsed.rpcAddress
				: undefined;
	if (!pid || !hubUrl || !isProcessRunning(pid)) {
		return undefined;
	}
	const config = connectorActiveStateConfigs[type];
	if (!config) {
		return undefined;
	}
	const fields: Partial<
		Omit<ActiveConnectorRecord, "id" | "type" | "pid" | "hubUrl">
	> = {};
	for (const key of config.required) {
		const value = connectorFieldExtractors[key](parsed);
		if (!value || (typeof value === "string" && !value.trim())) {
			return undefined;
		}
		(fields as Record<string, unknown>)[key] = value;
	}
	for (const key of config.optional) {
		const value = connectorFieldExtractors[key](parsed);
		if (value !== undefined) {
			(fields as Record<string, unknown>)[key] = value;
		}
	}
	return {
		id: connectorRecordId(type, fields, pid),
		type,
		pid,
		hubUrl,
		...fields,
	} as ActiveConnectorRecord;
}

function listActiveConnectors(): ActiveConnectorRecord[] {
	const records: ActiveConnectorRecord[] = [];
	for (const { name } of listConnectorCatalog()) {
		for (const statePath of listConnectorStatePaths(name)) {
			const record = readActiveConnectorRecord(name, statePath);
			if (record) {
				records.push(record);
			}
		}
	}
	return records.sort((left, right) => {
		if (left.type !== right.type) {
			return left.type.localeCompare(right.type);
		}
		const leftName = left.botUsername ?? left.userName ?? "";
		const rightName = right.botUsername ?? right.userName ?? "";
		return leftName.localeCompare(rightName);
	});
}

function listConfiguredConnectors(): ConfiguredConnectorRecord[] {
	const settings = readConnectorSettings();
	return Object.entries(settings.connectors)
		.map(([id, entry]) => ({
			id,
			type: entry.type,
			configuredAt: entry.configuredAt,
			updatedAt: entry.updatedAt,
		}))
		.sort((left, right) => left.type.localeCompare(right.type));
}

function connectorChannelsPayload(): ConnectorChannelsResponse {
	return {
		available: connectorChannelsFromPlatforms(),
		active: listActiveConnectors(),
		configured: listConfiguredConnectors(),
	};
}

function validateRequiredField(
	field: ConnectorFieldDef,
	values: Record<string, string>,
): void {
	if (field.required && !values[field.flag]?.trim()) {
		throw new Error(`${field.label} is required`);
	}
}

function configureConnector(payload: unknown): ConnectorChannelsResponse {
	if (!isRecord(payload)) {
		throw new Error("connector.configure payload must be an object.");
	}
	const channel = asString(payload.channel);
	if (!channel) {
		throw new Error("channel is required");
	}
	const platform = CONNECTOR_PLATFORMS.find((entry) => entry.id === channel);
	if (!platform) {
		throw new Error(`unknown connector channel: ${channel}`);
	}
	const supported = new Set(listConnectorCatalog().map((entry) => entry.name));
	if (!supported.has(platform.id)) {
		throw new Error(`connector channel is not available: ${channel}`);
	}

	const values = normalizeStringRecord(payload.values);
	const fieldValues: Record<string, string> = {};
	for (const field of platform.fields) {
		fieldValues[field.flag] = values[field.flag] ?? field.initialValue ?? "";
	}
	for (const field of platform.fields) {
		if (shouldIncludeConnectorField(field, fieldValues)) {
			validateRequiredField(field, fieldValues);
		}
	}

	const securityInput = isRecord(payload.security) ? payload.security : {};
	const securityEnabled = securityInput.enabled === true;
	const securityValues = normalizeStringRecord(securityInput.values);
	if (securityEnabled && platform.security) {
		for (const field of platform.security.fields) {
			const value = securityValues[field.key];
			if (!value) {
				throw new Error(field.requiredMessage);
			}
			const validationError = field.validate?.(value);
			if (validationError) {
				throw new Error(validationError);
			}
		}
	}

	const settings = readConnectorSettings();
	const now = new Date().toISOString();
	const existing = settings.connectors[channel];
	settings.connectors[channel] = {
		type: channel,
		values: fieldValues,
		security: securityEnabled
			? { enabled: true, values: securityValues }
			: { enabled: false, values: {} },
		configuredAt: existing?.configuredAt ?? now,
		updatedAt: now,
	};
	writeConnectorSettings(settings);
	return connectorChannelsPayload();
}

function deleteConnectorConfig(payload: unknown): ConnectorChannelsResponse {
	if (!isRecord(payload)) {
		throw new Error("connector.delete_config payload must be an object.");
	}
	const channel = asString(payload.channel);
	if (!channel) {
		throw new Error("channel is required");
	}
	const settings = readConnectorSettings();
	delete settings.connectors[channel];
	if (Object.keys(settings.connectors).length > 0) {
		writeConnectorSettings(settings);
	} else {
		rmSync(resolveConnectorSettingsPath(), { force: true });
	}
	return connectorChannelsPayload();
}

export async function handleConnectorCommand(
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	try {
		if (envelope.command === "connector.channels") {
			return okReply(envelope, connectorChannelsPayload());
		}
		if (envelope.command === "connector.configure") {
			return okReply(envelope, configureConnector(envelope.payload));
		}
		if (envelope.command === "connector.delete_config") {
			return okReply(envelope, deleteConnectorConfig(envelope.payload));
		}
		return errorReply(
			envelope,
			"unsupported_connector_command",
			`unsupported connector command: ${envelope.command}`,
		);
	} catch (error) {
		return errorReply(
			envelope,
			"connector_command_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export const __test__ = {
	configureConnector,
	connectorChannelsPayload,
	deleteConnectorConfig,
	resolveConnectorSettingsPath,
};
