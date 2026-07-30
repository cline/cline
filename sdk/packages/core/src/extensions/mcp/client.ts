import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import {
	type AgentToolContext,
	formatMcpTimeoutErrorMessage,
	isMcpTimeoutConfigured,
} from "@cline/shared";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
	createMcpOAuthProviderContext,
	createMcpSdkTransport,
	type McpOAuthProviderContext,
} from "./oauth";
import { augmentMcpTimeoutError, resolveMcpRequestTimeoutMs } from "./timeout";
import type {
	McpServerClient,
	McpServerClientFactory,
	McpServerRegistration,
	McpToolCallResult,
	McpToolDescriptor,
} from "./types";

type JsonRpcRequest = {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: Record<string, unknown>;
};

type JsonRpcMessage = {
	jsonrpc?: "2.0";
	id?: number;
	method?: string;
	result?: unknown;
	error?: {
		code?: number;
		message?: string;
		data?: unknown;
	};
};

const MCP_PROTOCOL_VERSION = "2024-11-05";
// Initialize budget when no timeout is configured. A configured `timeout`
// raises it, which lets slow-starting servers (e.g. uvx downloading on first
// run) get through initialize.
const MCP_CONNECT_PROBE_TIMEOUT_MS = 1_500;
const DEFAULT_HTTP_MCP_REDIRECT_URL =
	"http://127.0.0.1:1456/mcp/oauth/callback";

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Both stdio framings were tried during connect and both failed. When the two
 * attempts failed the same way (typically both timed out), the shared message
 * is the whole story and the newline error is rethrown unchanged; otherwise
 * each framing's error is named so neither diagnostic is lost.
 */
function combineInitializeErrors(
	serverName: string,
	newlineError: unknown,
	framedError: unknown,
): Error {
	const newlineMessage = toErrorMessage(newlineError);
	const framedMessage = toErrorMessage(framedError);
	if (newlineMessage === framedMessage) {
		return newlineError instanceof Error
			? newlineError
			: new Error(newlineMessage);
	}
	return new Error(
		`MCP server "${serverName}" failed to initialize. ` +
			`Newline-delimited attempt: ${newlineMessage} ` +
			`Content-Length framed attempt: ${framedMessage}`,
	);
}

function encodeNewlineMessage(message: Record<string, unknown>): Buffer {
	return Buffer.from(`${JSON.stringify(message)}\n`, "utf8");
}

function encodeFramedMessage(message: Record<string, unknown>): Buffer {
	const body = Buffer.from(JSON.stringify(message), "utf8");
	return Buffer.concat([
		Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, "utf8"),
		body,
	]);
}

type StdioProtocolMode = "newline" | "framed";

class FramedMessageParser {
	private buffer = "";
	private readonly decoder = new StringDecoder("utf8");

	push(chunk: Buffer): string[] {
		this.buffer += this.decoder.write(chunk);
		const messages: string[] = [];
		while (true) {
			const separatorIndex = this.buffer.indexOf("\r\n\r\n");
			if (separatorIndex < 0) {
				break;
			}
			const headerText = this.buffer.slice(0, separatorIndex);
			const contentLengthMatch = headerText.match(
				/(?:^|\r\n)Content-Length:\s*(\d+)(?:\r\n|$)/i,
			);
			if (!contentLengthMatch) {
				throw new Error(
					"Invalid MCP stdio frame: missing Content-Length header.",
				);
			}
			const contentLength = Number.parseInt(contentLengthMatch[1], 10);
			const bodyStart = separatorIndex + 4;
			const bodyEnd = bodyStart + contentLength;
			if (this.buffer.length < bodyEnd) {
				break;
			}
			messages.push(this.buffer.slice(bodyStart, bodyEnd));
			this.buffer = this.buffer.slice(bodyEnd);
		}
		return messages;
	}
}

class NewlineMessageParser {
	private buffer = "";
	private readonly decoder = new StringDecoder("utf8");

	push(chunk: Buffer): string[] {
		this.buffer += this.decoder.write(chunk);
		const messages: string[] = [];

		while (true) {
			const newlineIndex = this.buffer.indexOf("\n");
			if (newlineIndex < 0) {
				break;
			}
			const line = this.buffer.slice(0, newlineIndex).trim();
			this.buffer = this.buffer.slice(newlineIndex + 1);
			if (line.length > 0) {
				messages.push(line);
			}
		}

		return messages;
	}
}

class StdioMcpClient implements McpServerClient {
	private readonly registration: McpServerRegistration;
	private process?: ChildProcessWithoutNullStreams;
	private nextRequestId = 1;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timeout: ReturnType<typeof setTimeout>;
			signal?: AbortSignal;
			onAbort?: () => void;
		}
	>();
	private framedParser = new FramedMessageParser();
	private newlineParser = new NewlineMessageParser();
	private stderrBuffer = "";
	private connected = false;
	private protocolMode: StdioProtocolMode = "newline";
	private readonly requestTimeoutMs: number;
	private readonly connectAttemptTimeoutMs: number;

	constructor(registration: McpServerRegistration) {
		this.registration = registration;
		this.requestTimeoutMs = resolveMcpRequestTimeoutMs(
			registration.timeoutSeconds,
		);
		// Keep the fast probe default unless the user opted into patience:
		// an unconfigured server must not stall startup longer than it did
		// before per-server timeouts existed.
		this.connectAttemptTimeoutMs = isMcpTimeoutConfigured(
			registration.timeoutSeconds,
		)
			? this.requestTimeoutMs
			: MCP_CONNECT_PROBE_TIMEOUT_MS;
	}

	async connect(): Promise<void> {
		if (this.connected) {
			return;
		}
		if (this.registration.transport.type !== "stdio") {
			throw new Error(
				`Unsupported MCP transport for "${this.registration.name}": ${this.registration.transport.type}`,
			);
		}

		const initializeParams = {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: "@cline/core", version: "0.0.0" },
		};
		this.spawnProcess("newline");
		try {
			await this.request(
				"initialize",
				initializeParams,
				this.connectAttemptTimeoutMs,
			);
		} catch (newlineError) {
			await this.disconnect().catch(() => {});
			this.spawnProcess("framed");
			try {
				await this.request(
					"initialize",
					initializeParams,
					this.connectAttemptTimeoutMs,
				);
			} catch (framedError) {
				await this.disconnect().catch(() => {});
				throw combineInitializeErrors(
					this.registration.name,
					newlineError,
					framedError,
				);
			}
		}
		this.notify("notifications/initialized");
		this.connected = true;
	}

	async disconnect(): Promise<void> {
		const child = this.process;
		this.connected = false;
		this.process = undefined;
		this.failAllPending(
			new Error(`Disconnected from MCP server "${this.registration.name}".`),
		);
		if (!child) {
			return;
		}
		child.kill();
	}

	async listTools(): Promise<readonly McpToolDescriptor[]> {
		const result = (await this.request("tools/list")) as {
			tools?: Array<{
				name?: string;
				description?: string;
				inputSchema?: Record<string, unknown>;
			}>;
		};
		return (result.tools ?? [])
			.filter(
				(
					tool,
				): tool is {
					name: string;
					description?: string;
					inputSchema: Record<string, unknown>;
				} =>
					typeof tool?.name === "string" &&
					typeof tool.inputSchema === "object" &&
					tool.inputSchema !== null,
			)
			.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			}));
	}

	async callTool(request: {
		name: string;
		arguments?: Record<string, unknown>;
		context?: AgentToolContext;
	}): Promise<McpToolCallResult> {
		return this.request(
			"tools/call",
			{
				name: request.name,
				arguments: request.arguments ?? {},
			},
			undefined,
			request.context?.signal,
		);
	}

	private spawnProcess(protocolMode: StdioProtocolMode): void {
		const transport = this.registration.transport;
		if (transport.type !== "stdio") {
			throw new Error(
				`Unsupported MCP transport for "${this.registration.name}": ${transport.type}`,
			);
		}

		this.framedParser = new FramedMessageParser();
		this.newlineParser = new NewlineMessageParser();
		this.stderrBuffer = "";
		this.protocolMode = protocolMode;

		const platformOptions =
			process.platform === "win32"
				? {
						windowsHide: true,
						shell: true,
					}
				: {};
		const child = spawn(transport.command, transport.args ?? [], {
			cwd: transport.cwd,
			env: {
				...process.env,
				...(transport.env ?? {}),
			},
			stdio: ["pipe", "pipe", "pipe"],
			...platformOptions,
		});

		this.process = child;
		child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
		child.stderr.on("data", (chunk: Buffer) => {
			if (this.process !== child) {
				return;
			}
			this.stderrBuffer += chunk.toString("utf8");
			if (this.stderrBuffer.length > 16_384) {
				this.stderrBuffer = this.stderrBuffer.slice(-16_384);
			}
		});
		child.once("error", (error) => {
			if (this.process !== child) {
				return;
			}
			this.failAllPending(
				new Error(`MCP process error: ${toErrorMessage(error)}`),
			);
		});
		child.once("exit", (code, signal) => {
			if (this.process !== child) {
				return;
			}
			this.connected = false;
			this.process = undefined;
			const suffix = this.stderrBuffer.trim()
				? ` stderr: ${this.stderrBuffer.trim()}`
				: "";
			this.failAllPending(
				new Error(
					`MCP process exited for "${this.registration.name}" (code=${code ?? "null"}, signal=${signal ?? "null"}).${suffix}`,
				),
			);
		});
	}

	private handleStdout(chunk: Buffer): void {
		try {
			const messages =
				this.protocolMode === "framed"
					? this.framedParser.push(chunk)
					: this.newlineParser.push(chunk);

			for (const messageText of messages) {
				const message = JSON.parse(messageText) as JsonRpcMessage;
				if (typeof message.id !== "number") {
					continue;
				}
				const pending = this.takePending(message.id);
				if (!pending) {
					continue;
				}
				if (message.error) {
					const errorMessage =
						message.error.message ||
						`MCP request failed with code ${message.error.code ?? "unknown"}`;
					pending.reject(new Error(errorMessage));
					continue;
				}
				pending.resolve(message.result);
			}
		} catch (error) {
			this.handleProtocolFailure(error);
		}
	}

	private handleProtocolFailure(error: unknown): void {
		const child = this.process;
		if (!child) {
			return;
		}

		this.connected = false;
		this.process = undefined;
		const stderrSuffix = this.stderrBuffer.trim()
			? ` stderr: ${this.stderrBuffer.trim()}`
			: "";
		this.failAllPending(
			new Error(
				`Invalid MCP response from "${this.registration.name}": ${toErrorMessage(error)}.${stderrSuffix}`,
			),
		);
		child.kill();
	}

	private async request(
		method: string,
		params?: Record<string, unknown>,
		timeoutMs = this.requestTimeoutMs,
		signal?: AbortSignal,
	): Promise<unknown> {
		const child = this.process;
		if (!child?.stdin.writable) {
			throw new Error(
				`MCP server "${this.registration.name}" is not connected.`,
			);
		}

		const id = this.nextRequestId++;
		const payload: JsonRpcRequest = {
			jsonrpc: "2.0",
			id,
			method,
			...(params ? { params } : {}),
		};

		const resultPromise = new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.takePending(id);
				reject(this.createTimeoutError(method, timeoutMs));
			}, timeoutMs);
			const onAbort = signal
				? () => {
						const pending = this.takePending(id);
						if (!pending) {
							return;
						}
						const error =
							signal.reason instanceof Error
								? signal.reason
								: Object.assign(
										new Error(
											`MCP request aborted for "${this.registration.name}" (${method}).`,
										),
										{ name: "AbortError" },
									);
						pending.reject(error);
					}
				: undefined;
			this.pending.set(id, { resolve, reject, timeout, signal, onAbort });
			if (signal && onAbort) {
				signal.addEventListener("abort", onAbort, { once: true });
				if (signal.aborted) {
					onAbort();
				}
			}
		});
		if (!this.pending.has(id)) {
			return resultPromise;
		}

		try {
			child.stdin.write(
				this.protocolMode === "framed"
					? encodeFramedMessage(payload)
					: encodeNewlineMessage(payload),
			);
		} catch (error) {
			const pending = this.takePending(id);
			if (pending) {
				pending.reject(
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}

		return resultPromise;
	}

	private createTimeoutError(method: string, timeoutMs: number): Error {
		return new Error(
			formatMcpTimeoutErrorMessage(this.registration.name, timeoutMs, method),
		);
	}

	private notify(method: string, params?: Record<string, unknown>): void {
		const child = this.process;
		if (!child?.stdin.writable) {
			return;
		}
		const payload = {
			jsonrpc: "2.0" as const,
			method,
			...(params ? { params } : {}),
		};
		child.stdin.write(
			this.protocolMode === "framed"
				? encodeFramedMessage(payload)
				: encodeNewlineMessage(payload),
		);
	}

	private failAllPending(error: Error): void {
		for (const id of [...this.pending.keys()]) {
			const pending = this.takePending(id);
			if (!pending) {
				continue;
			}
			pending.reject(error);
		}
	}

	private takePending(id: number):
		| {
				resolve: (value: unknown) => void;
				reject: (error: Error) => void;
				timeout: ReturnType<typeof setTimeout>;
				signal?: AbortSignal;
				onAbort?: () => void;
		  }
		| undefined {
		const pending = this.pending.get(id);
		if (!pending) {
			return undefined;
		}
		this.pending.delete(id);
		clearTimeout(pending.timeout);
		if (pending.signal && pending.onAbort) {
			pending.signal.removeEventListener("abort", pending.onAbort);
		}
		return pending;
	}
}

export interface DefaultMcpServerClientFactoryOptions {
	settingsPath?: string;
	clientName?: string;
	clientVersion?: string;
	fetch?: FetchLike;
}

class SdkUrlMcpClient implements McpServerClient {
	private client?: Client;
	private authContext?: McpOAuthProviderContext;
	private readonly requestTimeoutMs: number;

	constructor(
		private readonly registration: McpServerRegistration,
		private readonly options: DefaultMcpServerClientFactoryOptions,
	) {
		this.requestTimeoutMs = resolveMcpRequestTimeoutMs(
			registration.timeoutSeconds,
		);
	}

	async connect(): Promise<void> {
		if (this.client) {
			return;
		}
		if (this.registration.transport.type === "stdio") {
			throw new Error(
				`Unsupported MCP transport for "${this.registration.name}": ${this.registration.transport.type}`,
			);
		}

		const authContext = createMcpOAuthProviderContext({
			settingsPath: this.options.settingsPath,
			serverName: this.registration.name,
			redirectUrl:
				this.registration.oauth?.redirectUrl ?? DEFAULT_HTTP_MCP_REDIRECT_URL,
		});
		this.authContext = authContext;
		let client: Client | undefined;
		try {
			client = new Client({
				name: this.options.clientName?.trim() || "@cline/core",
				version: this.options.clientVersion?.trim() || "0.0.0",
			});
			const transport = createMcpSdkTransport({
				registration: this.registration,
				oauthProvider: authContext.provider,
				fetch: this.options.fetch,
			});
			await client.connect(transport, { timeout: this.requestTimeoutMs });
			await authContext.clearError();
			this.client = client;
		} catch (error) {
			await client?.close().catch(() => {});
			const effectiveError = augmentMcpTimeoutError(
				error,
				this.registration.name,
				this.requestTimeoutMs,
			);
			const message =
				error instanceof UnauthorizedError
					? this.formatUnauthorizedMessage(
							authContext.getLastAuthorizationUrl(),
						)
					: toErrorMessage(effectiveError);
			await authContext.markError(message);
			throw new Error(message);
		}
	}

	async disconnect(): Promise<void> {
		const activeClient = this.client;
		this.client = undefined;
		await activeClient?.close();
	}

	async listTools(): Promise<readonly McpToolDescriptor[]> {
		const client = await this.ensureConnectedClient();
		try {
			const result = await client.listTools(undefined, {
				timeout: this.requestTimeoutMs,
			});
			return result.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema:
					tool.inputSchema &&
					typeof tool.inputSchema === "object" &&
					!Array.isArray(tool.inputSchema)
						? tool.inputSchema
						: {},
			}));
		} catch (error) {
			return await this.handleOperationError(error);
		}
	}

	async callTool(request: {
		name: string;
		arguments?: Record<string, unknown>;
		context?: AgentToolContext;
	}): Promise<McpToolCallResult> {
		const client = await this.ensureConnectedClient();
		try {
			return await client.callTool(
				{
					name: request.name,
					arguments: request.arguments ?? {},
				},
				undefined,
				{
					timeout: this.requestTimeoutMs,
					signal: request.context?.signal,
				},
			);
		} catch (error) {
			return await this.handleOperationError(error);
		}
	}

	private async ensureConnectedClient(): Promise<Client> {
		if (!this.client) {
			await this.connect();
		}
		if (!this.client) {
			throw new Error(
				`MCP server "${this.registration.name}" is not connected.`,
			);
		}
		return this.client;
	}

	private formatUnauthorizedMessage(authUrl: string | undefined): string {
		const base = `MCP server "${this.registration.name}" requires OAuth authorization.`;
		if (!authUrl) {
			return `${base} Run authorizeMcpServerOAuth for this server.`;
		}
		return `${base} Run authorizeMcpServerOAuth for this server and complete this URL: ${authUrl}`;
	}

	private async handleOperationError(error: unknown): Promise<never> {
		const authContext =
			this.authContext ??
			createMcpOAuthProviderContext({
				settingsPath: this.options.settingsPath,
				serverName: this.registration.name,
				redirectUrl:
					this.registration.oauth?.redirectUrl ?? DEFAULT_HTTP_MCP_REDIRECT_URL,
			});
		const effectiveError = augmentMcpTimeoutError(
			error,
			this.registration.name,
			this.requestTimeoutMs,
		);
		const message =
			error instanceof UnauthorizedError
				? this.formatUnauthorizedMessage(authContext.getLastAuthorizationUrl())
				: toErrorMessage(effectiveError);
		await authContext.markError(message);
		throw new Error(message);
	}
}

export function createDefaultMcpServerClientFactory(
	options: DefaultMcpServerClientFactoryOptions = {},
): McpServerClientFactory {
	return (registration) =>
		registration.transport.type === "stdio"
			? new StdioMcpClient(registration)
			: new SdkUrlMcpClient(registration, options);
}
