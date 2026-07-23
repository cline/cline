import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ActiveConnectorRecord,
	ConfiguredConnectorRecord,
	ConnectorChannelsResponse,
	ConnectorFieldDef,
	ConnectorPlatformDef,
	HubCommandEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import {
	CONNECTOR_PLATFORMS,
	connectorChannelsFromPlatforms,
	listConnectorCatalog,
	shouldIncludeConnectorField,
} from "@cline/shared";
import { withConnectorStore } from "@cline/shared/db";
import { resolveConnectorDataDir } from "@cline/shared/storage";
import { captureToolUsage } from "../../../services/telemetry/core-events";
import { errorReply, type HubTransportContext, okReply } from "./context";

type ConnectorFieldKey = keyof Omit<
	ActiveConnectorRecord,
	"id" | "type" | "pid" | "hubUrl"
>;

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
	const dir = join(resolveConnectorDataDir(), type);
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
	return withConnectorStore((store) => store.list())
		.map((entry) => ({
			id: entry.channel,
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

function buildActiveConnectorFieldValues(
	platform: ConnectorPlatformDef,
	values: Record<string, string>,
): Record<string, string> {
	const fieldValues: Record<string, string> = {};
	for (const field of platform.fields) {
		fieldValues[field.flag] = values[field.flag] ?? field.initialValue ?? "";
	}

	const activeFieldValues: Record<string, string> = {};
	for (const field of platform.fields) {
		if (!shouldIncludeConnectorField(field, fieldValues)) {
			continue;
		}
		validateRequiredField(field, fieldValues);
		activeFieldValues[field.flag] = fieldValues[field.flag];
	}
	return activeFieldValues;
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
	const fieldValues = buildActiveConnectorFieldValues(platform, values);

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

	withConnectorStore((store) =>
		store.upsertConfig({
			channel,
			type: channel,
			values: fieldValues,
			security: securityEnabled
				? { enabled: true, values: securityValues }
				: { enabled: false, values: {} },
		}),
	);
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
	withConnectorStore((store) => store.delete(channel));
	return connectorChannelsPayload();
}

function isStateMutatingConnectorCommand(
	command: HubCommandEnvelope["command"],
) {
	return (
		command === "connector.configure" || command === "connector.delete_config"
	);
}

function captureConnectorCommandUsage(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	success: boolean,
): void {
	if (!isStateMutatingConnectorCommand(envelope.command)) {
		return;
	}
	captureToolUsage(ctx.telemetry, {
		ulid: envelope.sessionId ?? envelope.requestId ?? "hub",
		tool: envelope.command,
		success,
	});
}

export async function handleConnectorCommand(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	try {
		if (envelope.command === "connector.channels") {
			return okReply(envelope, connectorChannelsPayload());
		}
		if (envelope.command === "connector.configure") {
			const payload = configureConnector(envelope.payload);
			captureConnectorCommandUsage(ctx, envelope, true);
			return okReply(envelope, payload);
		}
		if (envelope.command === "connector.delete_config") {
			const payload = deleteConnectorConfig(envelope.payload);
			captureConnectorCommandUsage(ctx, envelope, true);
			return okReply(envelope, payload);
		}
		return errorReply(
			envelope,
			"unsupported_connector_command",
			`unsupported connector command: ${envelope.command}`,
		);
	} catch (error) {
		captureConnectorCommandUsage(ctx, envelope, false);
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
};
