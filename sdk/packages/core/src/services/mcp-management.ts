import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type {
	McpServerConfigInput,
	McpServerInspection,
	McpServersResponse,
} from "@cline/shared";
import { resolveMcpSettingsPath } from "@cline/shared/storage";
import {
	createDefaultMcpServerClientFactory,
	probeMcpServerConnection,
} from "../extensions/mcp/client";
import {
	getMcpServerOAuthStatus,
	parseMcpServerRegistration,
	resolveMcpServerRegistration,
	updateMcpSettingsFile,
} from "../extensions/mcp/config-loader";
import type { McpServerTransportConfig } from "../extensions/mcp/types";
import { buildMcpInstallTransport, parseMcpInstallArgs } from "./mcp-install";
import { McpOAuthService } from "./mcp-oauth-service";

type JsonRecord = Record<string, unknown>;
function stringMap(value: object): Record<string, string> {
	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}
export function readMcpServersResponse(): McpServersResponse {
	const settingsPath = resolveMcpSettingsPath();
	if (!existsSync(settingsPath)) {
		return { settingsPath, hasSettingsFile: false, servers: [] };
	}
	const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as JsonRecord;
	return buildMcpServersResponse(settingsPath, parsed);
}

export function buildMcpServersResponse(
	settingsPath: string,
	parsed: JsonRecord,
): McpServersResponse {
	const serversValue = parsed.mcpServers;
	const servers =
		serversValue &&
		typeof serversValue === "object" &&
		!Array.isArray(serversValue)
			? (serversValue as JsonRecord)
			: {};
	const entries = Object.entries(servers).map(([name, body]) => {
		const record =
			body && typeof body === "object" && !Array.isArray(body)
				? (body as JsonRecord)
				: {};
		const transport =
			record.transport && typeof record.transport === "object"
				? (record.transport as JsonRecord)
				: undefined;
		let registration: ReturnType<typeof parseMcpServerRegistration> | undefined;
		let configurationError: string | undefined;
		try {
			registration = parseMcpServerRegistration(name, body);
		} catch (error) {
			configurationError =
				error instanceof Error ? error.message : String(error);
		}
		const resolvedTransport = registration?.transport;
		const rawTransportType = String(
			transport?.type ?? record.transportType ?? record.type ?? "",
		).trim();
		const hasRawUrl =
			typeof transport?.url === "string" || typeof record.url === "string";
		const fallbackTransportType =
			rawTransportType === "sse"
				? "sse"
				: rawTransportType === "streamableHttp" || rawTransportType === "http"
					? "streamableHttp"
					: hasRawUrl
						? "sse"
						: "stdio";
		const oauthStatus = registration
			? getMcpServerOAuthStatus(registration)
			: undefined;
		return {
			name,
			transportType: resolvedTransport?.type ?? fallbackTransportType,
			disabled: record.disabled === true,
			command: resolvedTransport
				? resolvedTransport.type === "stdio"
					? resolvedTransport.command
					: undefined
				: typeof transport?.command === "string"
					? transport.command
					: typeof record.command === "string"
						? record.command
						: undefined,
			args: resolvedTransport
				? resolvedTransport.type === "stdio"
					? resolvedTransport.args
					: undefined
				: Array.isArray(transport?.args)
					? transport.args.filter(
							(value): value is string => typeof value === "string",
						)
					: Array.isArray(record.args)
						? record.args.filter(
								(value): value is string => typeof value === "string",
							)
						: undefined,
			cwd: resolvedTransport
				? resolvedTransport.type === "stdio"
					? resolvedTransport.cwd
					: undefined
				: typeof transport?.cwd === "string"
					? transport.cwd
					: typeof record.cwd === "string"
						? record.cwd
						: undefined,
			env: resolvedTransport
				? resolvedTransport.type === "stdio"
					? resolvedTransport.env
					: undefined
				: transport?.env && typeof transport.env === "object"
					? stringMap(transport.env)
					: record.env && typeof record.env === "object"
						? stringMap(record.env)
						: undefined,
			url: resolvedTransport
				? resolvedTransport.type !== "stdio"
					? resolvedTransport.url
					: undefined
				: typeof transport?.url === "string"
					? transport.url
					: typeof record.url === "string"
						? record.url
						: undefined,
			headers: resolvedTransport
				? resolvedTransport.type !== "stdio"
					? resolvedTransport.headers
					: undefined
				: transport?.headers && typeof transport.headers === "object"
					? stringMap(transport.headers)
					: record.headers && typeof record.headers === "object"
						? stringMap(record.headers)
						: undefined,
			metadata:
				registration?.metadata ??
				(record.metadata &&
				typeof record.metadata === "object" &&
				!Array.isArray(record.metadata)
					? (record.metadata as JsonRecord)
					: undefined),
			...(configurationError ? { configurationError } : {}),
			oauthStatus: oauthStatus
				? {
						supported: oauthStatus.oauthSupported,
						configured: oauthStatus.oauthConfigured,
						authorizationRequired: oauthStatus.authorizationRequired,
						lastError: oauthStatus.lastError,
						lastAuthenticatedAt: oauthStatus.lastAuthenticatedAt,
					}
				: undefined,
		};
	});
	return { settingsPath, hasSettingsFile: true, servers: entries };
}

export async function ensureMcpSettingsFile(): Promise<string> {
	const path = resolveMcpSettingsPath();
	if (!existsSync(path))
		await updateMcpSettingsFile(path, (settings) => {
			settings.mcpServers ??= {};
		});
	return path;
}

/** Serializes mutations and network checks so late probes cannot undo later Hub edits. */
export class McpManagementService {
	readonly oauth = new McpOAuthService((operation) => this.enqueue(operation));
	async dispose() {
		await this.oauth.dispose();
	}

	private tail: Promise<unknown> = Promise.resolve();
	private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
		const next = this.tail.then(operation);
		this.tail = next.catch(() => undefined);
		return next;
	}
	list() {
		return readMcpServersResponse();
	}
	ensure() {
		return this.enqueue(async () => ({
			settingsPath: await ensureMcpSettingsFile(),
		}));
	}
	install(args: string[]) {
		this.oauth.cancelServer(parseMcpInstallArgs(args).name.trim());
		return this.enqueue(async () => {
			const result = buildMcpInstallTransport(parseMcpInstallArgs(args));
			await updateMcpSettingsFile(resolveMcpSettingsPath(), (settings) => {
				const servers = settings.mcpServers as JsonRecord;
				servers[result.name] = { transport: result.transport };
			});
			return { ...result, status: "installed" as const };
		});
	}
	delete(name: string) {
		this.oauth.cancelServer(name);
		return this.enqueue(async () => {
			await updateMcpSettingsFile(resolveMcpSettingsPath(), (settings) => {
				const servers = settings.mcpServers as JsonRecord | undefined;
				if (servers) delete servers[name];
			});
			return this.list();
		});
	}
	setDisabled(name: string, disabled: boolean) {
		this.oauth.cancelServer(name);
		return this.enqueue(async () => {
			const path = resolveMcpSettingsPath();
			if (disabled) {
				await this.writeDisabled(name, true);
				return this.list();
			}
			const registration = resolveMcpServerRegistration(name, {
				filePath: path,
			});
			if (!registration) throw new Error(`unknown MCP server: ${name}`);
			if (registration.transport.type !== "stdio") {
				await this.writeDisabled(name, true);
				const probe = await probeMcpServerConnection({
					serverName: name,
					filePath: path,
				});
				if (!probe.connected) return this.list();
				await this.enableIfUnchanged(name, registration.transport);
			} else await this.writeDisabled(name, disabled);
			return this.list();
		});
	}
	private async writeDisabled(name: string, disabled: boolean) {
		await updateMcpSettingsFile(resolveMcpSettingsPath(), (settings) => {
			const servers = settings.mcpServers as JsonRecord;
			const current = Object.hasOwn(servers, name) ? servers[name] : undefined;
			if (!current || typeof current !== "object" || Array.isArray(current))
				throw new Error(`unknown MCP server: ${name}`);
			servers[name] = { ...current, disabled };
		});
	}

	private async enableIfUnchanged(
		name: string,
		transport: McpServerTransportConfig,
	) {
		await updateMcpSettingsFile(resolveMcpSettingsPath(), (settings) => {
			const servers = settings.mcpServers as JsonRecord | undefined;
			const current = servers?.[name];
			if (!servers || !current || typeof current !== "object") return;
			if (
				isDeepStrictEqual(
					parseMcpServerRegistration(name, current).transport,
					transport,
				)
			) {
				servers[name] = { ...current, disabled: false };
			}
		});
	}
	upsert(input: McpServerConfigInput) {
		this.oauth.cancelServer(input.name);
		if (input.previousName !== undefined)
			this.oauth.cancelServer(input.previousName);
		return this.enqueue(async () => {
			const {
				name,
				previousName,
				disabled = false,
				metadata,
				transportType,
				...fields
			} = input;
			const transport = { type: transportType, ...fields };
			// Validate before touching the file, including normalized mcp-remote transports.
			const nextRegistration = parseMcpServerRegistration(name, {
				transport,
				disabled,
				metadata,
			});
			const path = resolveMcpSettingsPath();
			const { shouldProbe } = await updateMcpSettingsFile(path, (settings) => {
				const servers = (settings.mcpServers ?? {}) as JsonRecord;
				const existingName =
					previousName !== undefined && Object.hasOwn(servers, previousName)
						? previousName
						: name;
				const existing = servers[existingName] as JsonRecord | undefined;
				let existingTransport: { type: string; url?: string } | undefined;
				if (existing) {
					// Only transport fields determine credential ownership. Bad metadata or
					// OAuth bookkeeping must not make an unchanged endpoint look different.
					const {
						transport,
						command,
						args,
						cwd,
						env,
						url,
						headers,
						transportType,
						type,
					} = existing;
					try {
						existingTransport = parseMcpServerRegistration(existingName, {
							transport,
							command,
							args,
							cwd,
							env,
							url,
							headers,
							transportType,
							type,
						}).transport;
					} catch {
						// Repair unrelated or malformed fields without losing ownership of a
						// still-identifiable endpoint. Match the catalog's raw-field projection.
						const raw =
							transport && typeof transport === "object"
								? (transport as JsonRecord)
								: existing;
						const rawUrl =
							typeof raw.url === "string"
								? raw.url
								: typeof url === "string"
									? url
									: undefined;
						const rawType = String(
							raw.type ?? transportType ?? type ?? (rawUrl ? "sse" : "stdio"),
						).trim();
						existingTransport = {
							type: rawType === "http" ? "streamableHttp" : rawType,
							url: rawUrl,
						};
					}
				}
				const sameEndpoint =
					existingTransport !== undefined &&
					existingTransport.type === nextRegistration.transport.type &&
					(nextRegistration.transport.type === "stdio" ||
						(existingTransport.type !== "stdio" &&
							existingTransport.url === nextRegistration.transport.url));
				const shouldProbe =
					nextRegistration.transport.type !== "stdio" &&
					!disabled &&
					!(existing?.disabled !== true && sameEndpoint);
				const record: JsonRecord = {
					transport,
					disabled: disabled || shouldProbe,
					metadata: metadata ?? existing?.metadata,
				};
				if (sameEndpoint) {
					if (existing?.oauth !== undefined) record.oauth = existing.oauth;
					if (existing?.oauthClient !== undefined)
						record.oauthClient = existing.oauthClient;
				}
				// Preserve settings not exposed by the editor, including the request timeout.
				if (existing?.timeout !== undefined) record.timeout = existing.timeout;
				if (previousName !== undefined && previousName !== name)
					delete servers[previousName];
				servers[name] = record;
				settings.mcpServers = servers;
				return { shouldProbe };
			});
			if (shouldProbe) {
				const probe = await probeMcpServerConnection({
					serverName: name,
					filePath: path,
				});
				if (probe.connected)
					await this.enableIfUnchanged(name, nextRegistration.transport);
			}
			return this.list();
		});
	}
	inspect(name: string): Promise<McpServerInspection> {
		return this.enqueue(async () => {
			const path = resolveMcpSettingsPath();
			const registration = resolveMcpServerRegistration(name, {
				filePath: path,
			});
			if (!registration) throw new Error(`unknown MCP server: ${name}`);
			const client = await createDefaultMcpServerClientFactory({
				settingsPath: path,
			})(registration);
			try {
				await client.connect();
				const tools = await client.listTools();
				return {
					name,
					connected: true,
					tools: tools.map((tool) => ({
						name: tool.name,
						description: tool.description,
						inputSchema: tool.inputSchema,
					})),
				};
			} catch (error) {
				return {
					name,
					connected: false,
					tools: [],
					error: error instanceof Error ? error.message : String(error),
				};
			} finally {
				await client.disconnect().catch(() => undefined);
			}
		});
	}
}
