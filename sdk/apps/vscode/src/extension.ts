import * as os from "node:os";
import { basename, join } from "node:path";
import {
	type BasicLogger,
	buildWorkspaceMetadata,
	ClineCore,
	captureExtensionActivated,
	createConfiguredTelemetryService,
	createLocalHubScheduleRuntimeHandlers,
	ensureHubWebSocketServer,
	type ITelemetryService,
	Llms,
	NodeHubClient,
	type ProviderModel,
	ProviderSettingsManager,
	probeHubServer,
	type RuntimeCapabilities,
	readHubDiscovery,
	resolveSharedHubOwnerContext,
	type ToolPolicy,
} from "@clinebot/core";
import {
	type AgentTool,
	buildClineSystemPrompt,
	createClineTelemetryServiceConfig,
	createClineTelemetryServiceMetadata,
} from "@clinebot/shared";
import * as vscode from "vscode";
import { displayName, version } from "../package.json";
import { createVsCodeRuntimeCapabilities } from "./runtime-capabilities";
import { createVscodeTelemetry } from "./telemetry";
import type {
	WebviewChatMessage,
	WebviewInboundMessage,
	WebviewOutboundMessage,
	WebviewSessionSummary,
} from "./webview-protocol";

const SESSION_REFRESH_INTERVAL_MS = 4_000;
const SESSION_HISTORY_LIMIT = 50;
const HUB_DAEMON_TIMEOUT_MS = 8_000;
const HUB_POLL_INTERVAL_MS = 200;
const TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS = 5_000;
const TERMINAL_EXECUTION_TIMEOUT_MS = 120_000;
const TERMINAL_OUTPUT_LIMIT = 1_000_000;
const REFRESH_SESSION_EVENTS = new Set([
	"session.created",
	"session.updated",
	"session.attached",
	"session.detached",
	"run.started",
	"run.completed",
	"run.failed",
	"run.aborted",
]);

let extensionTelemetryHandle:
	| ReturnType<typeof createVscodeTelemetry>
	| undefined;

export function activate(context: vscode.ExtensionContext): void {
	const outputChannel = vscode.window.createOutputChannel("Cline");
	extensionTelemetryHandle = createVscodeTelemetry({
		extensionVersion: version,
		clineType: displayName,
		platform: vscode.env.appName,
		platformVersion: vscode.version,
	});
	captureExtensionActivated(extensionTelemetryHandle.telemetry);
	const sidebarProvider = new ClineChatViewProvider(
		context.extensionUri,
		outputChannel,
		extensionTelemetryHandle.telemetry,
	);
	context.subscriptions.push(
		outputChannel,
		vscode.window.registerWebviewViewProvider(
			"clineVscode.chatView",
			sidebarProvider,
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
		vscode.commands.registerCommand("clineVscode.openChat", () => {
			const panel = vscode.window.createWebviewPanel(
				"clineChat",
				"Cline Chat",
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					localResourceRoots: [
						vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
					],
				},
			);
			const controller = new CoreChatWebviewController(
				panel.webview,
				context.extensionUri,
				outputChannel,
				panel.onDidDispose,
				extensionTelemetryHandle?.telemetry,
			);
			context.subscriptions.push(controller);
		}),
	);
}

export function deactivate(): Promise<void> {
	const handle = extensionTelemetryHandle;
	extensionTelemetryHandle = undefined;
	if (!handle) return Promise.resolve();
	return handle.flush().finally(() => handle.dispose());
}

class ClineChatViewProvider implements vscode.WebviewViewProvider {
	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly sharedTelemetry?: ITelemetryService,
	) {}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
			],
		};
		const controller = new CoreChatWebviewController(
			webviewView.webview,
			this.extensionUri,
			this.outputChannel,
			webviewView.onDidDispose,
			this.sharedTelemetry,
		);
		webviewView.onDidDispose(() => controller.dispose());
	}
}

type StartConfig = {
	providerId: string;
	modelId: string;
	cwd: string;
	workspaceRoot: string;
	systemPrompt: string;
	maxIterations?: number;
	thinking?: boolean;
	enableTools: boolean;
	enableSpawnAgent: boolean;
	enableAgentTeams: boolean;
	teamName: string;
	missionLogIntervalSteps: number;
	missionLogIntervalMs: number;
	checkpoint: { enabled: true };
	mode: "act" | "plan";
	apiKey: string;
	autoApproveTools?: boolean;
	logger: BasicLogger;
	extensionContext?: import("@clinebot/shared").ExtensionContext;
	extraTools?: AgentTool[];
};

type ProviderListItem = {
	id: string;
	name: string;
	enabled: boolean;
	defaultModelId?: string;
};

type HubEventEnvelope = {
	event: string;
	sessionId?: string;
	payload?: Record<string, unknown>;
};

type HubResolution = {
	url: string;
	authToken?: string;
};

type LlmModelInfo = {
	name?: string;
	capabilities?: string[];
	thinkingConfig?: unknown;
};

type WebviewSendConfig = {
	provider?: string;
	model?: string;
	mode?: "act" | "plan";
	systemPrompt?: string;
	maxIterations?: number;
	thinking?: boolean;
	enableTools?: boolean;
	enableSpawn?: boolean;
	enableTeams?: boolean;
	autoApproveTools?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function stringifyContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (value == null) return "";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function parseSessionTimestamp(value: unknown): number | undefined {
	const timestamp =
		typeof value === "number"
			? value
			: typeof value === "string"
				? Date.parse(value)
				: Number.NaN;
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function readTerminalCommandInput(input: unknown): {
	command: string;
	cwd?: string;
} {
	if (typeof input === "string") {
		return { command: input.trim() };
	}
	const record = asRecord(input);
	const command =
		typeof record?.command === "string" ? record.command.trim() : "";
	const cwd = typeof record?.cwd === "string" ? record.cwd.trim() : "";
	return {
		command,
		...(cwd ? { cwd } : {}),
	};
}

async function waitForShellIntegration(
	terminal: vscode.Terminal,
	timeoutMs: number,
): Promise<vscode.TerminalShellIntegration | undefined> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (terminal.shellIntegration) {
			return terminal.shellIntegration;
		}
		await wait(100);
	}
	return terminal.shellIntegration;
}

async function readTerminalExecution(
	execution: vscode.TerminalShellExecution,
	abortSignal: AbortSignal | undefined,
	onChange: ((update: unknown) => void) | undefined,
): Promise<string> {
	let output = "";
	let outputSize = 0;
	const timeout = AbortSignal.timeout(TERMINAL_EXECUTION_TIMEOUT_MS);
	const abortPromise = new Promise<never>((_, reject) => {
		const onAbort = () => reject(new Error("Command was aborted"));
		const onTimeout = () =>
			reject(
				new Error(`Command timed out after ${TERMINAL_EXECUTION_TIMEOUT_MS}ms`),
			);
		abortSignal?.addEventListener("abort", onAbort, { once: true });
		timeout.addEventListener("abort", onTimeout, { once: true });
	});
	const readPromise = (async () => {
		for await (const chunk of execution.read()) {
			onChange?.({ stream: "stdout", chunk });
			outputSize += chunk.length;
			if (output.length < TERMINAL_OUTPUT_LIMIT) {
				output += chunk.slice(0, TERMINAL_OUTPUT_LIMIT - output.length);
			}
		}
		if (outputSize > TERMINAL_OUTPUT_LIMIT) {
			output += `\n\n[Output truncated: ${outputSize} characters total, showing first ${TERMINAL_OUTPUT_LIMIT} characters]`;
		}
		return output;
	})();
	return Promise.race([readPromise, abortPromise]);
}

function createVsCodeTerminalTool(defaultCwd: string): AgentTool {
	return {
		name: "vscode_terminal",
		description:
			"Run a shell command in the VS Code integrated terminal and return the captured terminal output when shell integration is available.",
		inputSchema: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: "The shell command to run in the integrated terminal.",
				},
				cwd: {
					type: "string",
					description:
						"Optional working directory. Defaults to the active workspace directory.",
				},
			},
			required: ["command"],
		},
		async execute(input, context) {
			const { command, cwd } = readTerminalCommandInput(input);
			if (!command) {
				throw new Error("command is required.");
			}
			const terminal = vscode.window.createTerminal({
				name: "Cline",
				cwd: cwd || defaultCwd,
			});
			terminal.show(true);
			context.emitUpdate?.({ stream: "stdout", chunk: `$ ${command}\n` });

			const shellIntegration = await waitForShellIntegration(
				terminal,
				TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS,
			);
			if (!shellIntegration) {
				terminal.sendText(command, true);
				return [
					"Command sent to the VS Code integrated terminal.",
					"Shell integration was not available, so output could not be captured.",
				].join("\n");
			}

			const execution = shellIntegration.executeCommand(command);
			const output = await readTerminalExecution(
				execution,
				context.signal,
				context.emitUpdate,
			);
			return output.trim() || "Command completed with no output.";
		},
	};
}

function readCheckpointEntriesByRunCount(
	value: unknown,
): Map<number, NonNullable<WebviewChatMessage["checkpoint"]>> {
	const entries = new Map<
		number,
		NonNullable<WebviewChatMessage["checkpoint"]>
	>();
	const history = asRecord(value)?.history;
	if (!Array.isArray(history)) return entries;

	for (const item of history) {
		const entry = asRecord(item);
		if (!entry) continue;
		const { ref, createdAt, runCount, kind } = entry;
		if (
			typeof ref !== "string" ||
			typeof createdAt !== "number" ||
			!Number.isFinite(createdAt) ||
			typeof runCount !== "number" ||
			!Number.isInteger(runCount) ||
			runCount < 1
		) {
			continue;
		}
		const validKind = kind === "stash" || kind === "commit" ? kind : undefined;
		entries.set(runCount, {
			ref,
			createdAt,
			runCount,
			...(validKind ? { kind: validKind } : {}),
		});
	}
	return entries;
}

type PersistedMessage = {
	id?: string;
	role?: string;
	content?:
		| string
		| Array<
				| { type: "text"; text: string }
				| { type: "reasoning"; text: string; redacted?: boolean }
				| {
						type: "tool-call";
						toolCallId: string;
						toolName: string;
						input?: unknown;
				  }
				| {
						type: "tool-result";
						toolCallId: string;
						toolName: string;
						output?: unknown;
						isError?: boolean;
				  }
		  >;
};

function mapPersistedMessagesToWebviewMessages(
	messages: PersistedMessage[],
	checkpointMetadata?: unknown,
): WebviewChatMessage[] {
	const checkpointsByRunCount =
		readCheckpointEntriesByRunCount(checkpointMetadata);
	let userRunCount = 0;

	return messages.flatMap((message, messageIndex) => {
		const messageKey = message.id ?? messageIndex;
		const textParts: string[] = [];
		const reasoningParts: string[] = [];
		let reasoningRedacted = false;
		const blocks: NonNullable<WebviewChatMessage["blocks"]> = [];
		const toolEvents = new Map<
			string,
			NonNullable<WebviewChatMessage["toolEvents"]>[number]
		>();

		const parts = Array.isArray(message.content)
			? message.content
			: typeof message.content === "string" && message.content.trim()
				? [{ type: "text" as const, text: message.content.trim() }]
				: [];

		for (const [partIndex, part] of parts.entries()) {
			switch (part.type) {
				case "text": {
					const text = part.text.trim();
					if (!text) break;
					textParts.push(text);
					blocks.push({
						id: `${messageKey}:text:${partIndex}`,
						type: "text",
						text,
					});
					break;
				}
				case "reasoning": {
					if (!part.text.trim()) break;
					reasoningParts.push(part.text);
					blocks.push({
						id: `${messageKey}:reasoning:${partIndex}`,
						type: "reasoning",
						text: part.text,
						redacted: part.redacted,
					});
					reasoningRedacted = reasoningRedacted || part.redacted === true;
					break;
				}
				case "tool-call": {
					const toolEvent = {
						id: `${messageKey}:${part.toolCallId}`,
						toolCallId: part.toolCallId,
						name: part.toolName,
						text: `Running ${part.toolName}...`,
						state: "input-available" as const,
						input: part.input,
					};
					toolEvents.set(part.toolCallId, toolEvent);
					blocks.push({
						id: `${messageKey}:tool:${part.toolCallId}`,
						type: "tool",
						toolEvent,
					});
					break;
				}
				case "tool-result": {
					const existing = toolEvents.get(part.toolCallId);
					const toolEvent = {
						id: existing?.id ?? `${messageKey}:${part.toolCallId}`,
						toolCallId: part.toolCallId,
						name: part.toolName,
						text: part.isError
							? `${part.toolName} failed`
							: `${part.toolName} completed`,
						state: part.isError
							? ("output-error" as const)
							: ("output-available" as const),
						input: existing?.input,
						output: part.output,
						error: part.isError ? stringifyContent(part.output) : undefined,
					};
					toolEvents.set(part.toolCallId, toolEvent);
					const blockId = `${messageKey}:tool:${part.toolCallId}`;
					const existingBlockIndex = blocks.findIndex(
						(block) =>
							block.type === "tool" &&
							block.toolEvent.toolCallId === part.toolCallId,
					);
					if (existingBlockIndex >= 0) {
						blocks[existingBlockIndex] = {
							id: blockId,
							type: "tool",
							toolEvent,
						};
					} else {
						blocks.push({ id: blockId, type: "tool", toolEvent });
					}
					break;
				}
			}
		}

		const text = textParts.join("\n");
		const toolEventList = [...toolEvents.values()];
		if (!text && reasoningParts.length === 0 && toolEventList.length === 0) {
			return [];
		}
		const role =
			message.role === "user"
				? "user"
				: message.role === "assistant"
					? "assistant"
					: "meta";
		const checkpoint =
			role === "user" ? checkpointsByRunCount.get(++userRunCount) : undefined;

		return [
			{
				id: message.id || `history-${messageIndex}`,
				role,
				text,
				reasoning:
					reasoningParts.length > 0 ? reasoningParts.join("\n") : undefined,
				reasoningRedacted: reasoningRedacted || undefined,
				checkpoint,
				toolEvents: toolEventList.length > 0 ? toolEventList : undefined,
				blocks: blocks.length > 0 ? blocks : undefined,
			},
		];
	});
}

class CoreChatWebviewController implements vscode.Disposable {
	private readonly logger: BasicLogger;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly providerSettingsManager = new ProviderSettingsManager();
	private readonly telemetry: ITelemetryService;
	private host: ClineCore | undefined;
	private hubClient: NodeHubClient | undefined;
	private stopHostSubscription: (() => void) | undefined;
	private stopSessionRefreshInterval: (() => void) | undefined;
	private stopSessionSubscription: (() => void) | undefined;
	private sessionId: string | undefined;
	private startConfig: StartConfig | undefined;
	private hubUrl: string | undefined;
	private hubAuthToken: string | undefined;
	private sending = false;

	constructor(
		private readonly webview: vscode.Webview,
		private readonly extensionUri: vscode.Uri,
		outputChannel: vscode.OutputChannel,
		onDidDispose?: vscode.Event<void>,
		sharedTelemetry?: ITelemetryService,
	) {
		this.logger = createOutputChannelLogger(outputChannel);
		this.disposables.push(
			this.webview.onDidReceiveMessage((message: WebviewInboundMessage) => {
				void this.handleMessage(message);
			}),
		);
		if (onDidDispose) {
			this.disposables.push(onDidDispose(() => this.dispose()));
		}

		if (sharedTelemetry) {
			this.telemetry = sharedTelemetry;
		} else {
			const { telemetry } = createConfiguredTelemetryService(
				createClineTelemetryServiceConfig({
					metadata: createClineTelemetryServiceMetadata({
						extension_version: version,
						cline_type: displayName,
						platform: vscode.env.appName,
						platform_version: vscode.version,
						os_type: os.platform(),
						os_version: os.version(),
					}),
				}),
			);
			this.telemetry = telemetry;
		}

		void this.initializeWebview();
	}

	public dispose(): void {
		this.stopEventStream();
		this.stopSessionRefreshInterval?.();
		this.stopSessionRefreshInterval = undefined;
		this.stopHostSubscription?.();
		this.stopHostSubscription = undefined;
		this.hubClient?.close();
		this.hubClient = undefined;
		if (this.sessionId && this.host) {
			void this.host.stop(this.sessionId).catch(() => undefined);
		}
		void this.host?.dispose("vscode_webview_dispose").catch(() => undefined);
		this.host = undefined;
		this.sessionId = undefined;
		this.startConfig = undefined;
		while (this.disposables.length > 0) {
			this.disposables.pop()?.dispose();
		}
	}

	private async handleMessage(message: WebviewInboundMessage): Promise<void> {
		switch (message.type) {
			case "ready":
				return this.initialize();
			case "loadModels":
				return this.loadModels(message.providerId);
			case "attachSession":
				return this.attachSession(message.sessionId);
			case "deleteSession":
				return this.deleteSession(message.sessionId);
			case "updateSessionMetadata":
				return this.updateSessionMetadata(message.sessionId, message.metadata);
			case "abort":
				return this.abortTurn();
			case "reset":
				return this.resetSession();
			case "forkSession":
				return this.forkSession();
			case "restore":
				return this.restore(message.checkpointRunCount);
			case "send":
				return this.sendPrompt(
					message.prompt,
					message.config,
					message.attachments,
				);
		}
	}

	private async initialize(): Promise<void> {
		try {
			await this.ensureHub();
			await this.getSessionHost();
			await this.post({ type: "status", text: "Cline is Ready" });
			const defaults = this.resolveWorkspaceDefaults();
			await this.post({ type: "defaults", defaults });
			await this.loadProviders(defaults.provider);
			await this.refreshSessions();
			if (!this.stopSessionRefreshInterval) {
				const interval = setInterval(() => {
					void this.refreshSessions().catch(() => undefined);
				}, SESSION_REFRESH_INTERVAL_MS);
				this.stopSessionRefreshInterval = () => clearInterval(interval);
			}
		} catch (error) {
			await this.postError(error);
		}
	}

	private async ensureHub(): Promise<void> {
		if (this.hubClient && this.hubUrl) {
			try {
				await this.hubClient.connect();
				return;
			} catch {
				this.hubClient.close();
				this.hubClient = undefined;
				this.hubUrl = undefined;
				this.hubAuthToken = undefined;
			}
		}

		const hub = await this.discoverOrStartHub();
		if (!hub) {
			throw new Error("No compatible hub runtime is available.");
		}
		this.hubUrl = hub.url;
		this.hubAuthToken = hub.authToken;

		const defaults = this.resolveWorkspaceDefaults();
		this.hubClient = new NodeHubClient({
			url: this.hubUrl,
			authToken: this.hubAuthToken,
			clientType: "vscode",
			displayName: "VS Code",
			workspaceRoot: defaults.workspaceRoot,
			cwd: defaults.cwd,
		});
		await this.hubClient.connect();
		this.hubClient.subscribe((event) => {
			void this.handleHubEvent(event as HubEventEnvelope);
		});
	}

	private async discoverOrStartHub(): Promise<HubResolution | undefined> {
		const owner = resolveSharedHubOwnerContext();

		if (this.hubUrl) {
			const healthy = await probeHubServer(this.hubUrl);
			if (healthy?.url) {
				return { url: healthy.url, authToken: this.hubAuthToken };
			}
		}

		const discovered = await this.probeDiscoveredHub(owner.discoveryPath);
		if (discovered) return discovered;

		await ensureHubWebSocketServer({
			owner,
			allowPortFallback: true,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});

		const deadline = Date.now() + HUB_DAEMON_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const next = await this.probeDiscoveredHub(owner.discoveryPath);
			if (next) return next;
			await new Promise((resolve) => setTimeout(resolve, HUB_POLL_INTERVAL_MS));
		}
		return undefined;
	}

	private async probeDiscoveredHub(
		discoveryPath: string,
	): Promise<HubResolution | undefined> {
		const discovery = await readHubDiscovery(discoveryPath);
		if (!discovery?.url) return undefined;
		const healthy = await probeHubServer(discovery.url);
		return healthy?.url
			? { url: healthy.url, authToken: discovery.authToken }
			: undefined;
	}

	private async initializeWebview(): Promise<void> {
		try {
			this.webview.html = await this.getWebviewHtml();
		} catch (error) {
			await this.postError(error);
		}
	}

	private async getWebviewHtml(): Promise<string> {
		const devServerUrl = process.env.VITE_DEV_SERVER_URL;
		return devServerUrl
			? this.getDevWebviewHtml(devServerUrl)
			: this.getProductionWebviewHtml();
	}

	private getDevWebviewHtml(devServerUrl: string): string {
		const url = new URL(devServerUrl);
		const csp = [
			"default-src 'none'",
			`img-src ${this.webview.cspSource} data: ${devServerUrl}`,
			`style-src ${this.webview.cspSource} 'unsafe-inline' ${devServerUrl}`,
			`font-src ${this.webview.cspSource} ${devServerUrl}`,
			`script-src 'unsafe-inline' ${devServerUrl}`,
			`connect-src ${devServerUrl} ws://${url.host} ws://localhost:${url.port}`,
		].join("; ");

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<script type="module">
		import RefreshRuntime from "${devServerUrl}/@react-refresh";
		RefreshRuntime.injectIntoGlobalHook(window);
		window.$RefreshReg$ = () => {};
		window.$RefreshSig$ = () => (type) => type;
		window.__vite_plugin_react_preamble_installed__ = true;
	</script>
	<script type="module" src="${devServerUrl}/@vite/client"></script>
</head>
<body>
	<div id="root"></div>
	<script type="module" src="${devServerUrl}/src/main.tsx"></script>
</body>
</html>`;
	}

	private async getProductionWebviewHtml(): Promise<string> {
		const distDir = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
		const indexPath = join(distDir.fsPath, "index.html");
		const nonce = createNonce();
		const buffer = await vscode.workspace.fs.readFile(
			vscode.Uri.file(indexPath),
		);

		let html = Buffer.from(buffer)
			.toString("utf8")
			.replace(
				/<(script|link)([^>]+?(?:src|href))="([^"]+)"([^>]*)>/g,
				(_match, tag, attrPrefix, assetPath, suffix) => {
					if (/^(?:https?:|data:)/.test(assetPath)) {
						return `<${tag}${attrPrefix}="${assetPath}"${suffix}>`;
					}
					const normalizedAssetPath = assetPath.replace(/^\.?\//, "");
					const assetUri = this.webview.asWebviewUri(
						vscode.Uri.joinPath(distDir, normalizedAssetPath),
					);
					const nonceAttr = tag === "script" ? ` nonce="${nonce}"` : "";
					return `<${tag}${nonceAttr}${attrPrefix}="${assetUri.toString()}"${suffix}>`;
				},
			);

		const csp = [
			"default-src 'none'",
			`img-src ${this.webview.cspSource} data:`,
			`style-src ${this.webview.cspSource} 'unsafe-inline'`,
			`font-src ${this.webview.cspSource}`,
			`script-src ${this.webview.cspSource} 'nonce-${nonce}'`,
		].join("; ");

		if (html.includes("<head>")) {
			html = html.replace(
				"<head>",
				`<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
			);
		}
		return html;
	}

	private resolveWorkspaceDefaults(): {
		provider?: string;
		model?: string;
		workspaceRoot: string;
		cwd: string;
	} {
		const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const cwd = folder ?? process.cwd();
		const lastUsed = this.providerSettingsManager.getLastUsedProviderSettings();
		return {
			provider: lastUsed?.provider,
			model: lastUsed?.model,
			workspaceRoot: cwd,
			cwd,
		};
	}

	private async loadProviders(preferredProvider?: string): Promise<void> {
		const state = this.providerSettingsManager.read();
		const ids = Llms.getProviderIds().sort((a, b) => a.localeCompare(b));
		const providers: ProviderListItem[] = (
			await Promise.all(
				ids.map(async (id) => {
					const info = await Llms.getProvider(id);
					return {
						id,
						name: info?.name ?? id,
						enabled: Boolean(state.providers[id]?.settings),
						defaultModelId: info?.defaultModelId,
					};
				}),
			)
		).filter((p) => p.enabled);
		await this.post({ type: "providers", providers });

		const selected =
			(preferredProvider &&
				providers.find((p) => p.id === preferredProvider)) ||
			providers[0];
		if (selected) {
			await this.loadModels(selected.id);
		}
	}

	private async loadModels(providerId: string): Promise<void> {
		const provider = providerId.trim();
		if (!provider) return;
		const modelMap = (await Llms.getModelsForProvider(provider)) as Record<
			string,
			LlmModelInfo
		>;
		const models: ProviderModel[] = Object.entries(modelMap)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([modelId, info]) => ({
				id: modelId,
				name: info.name ?? modelId,
				supportsAttachments: info.capabilities?.includes("files"),
				supportsThinking:
					Boolean(info.thinkingConfig) ||
					info.capabilities?.includes("reasoning"),
				supportsVision: info.capabilities?.includes("images"),
			}));
		await this.post({ type: "models", providerId: provider, models });
	}

	private async refreshSessions(): Promise<void> {
		const host = await this.getSessionHost();
		const sessions = (
			await host.list(SESSION_HISTORY_LIMIT, {
				hydrate: false,
				includeManifestFallback: true,
			})
		)
			.sort(
				(a, b) =>
					(parseSessionTimestamp(b.updatedAt) ?? 0) -
					(parseSessionTimestamp(a.updatedAt) ?? 0),
			)
			.map(
				(session): WebviewSessionSummary => ({
					sessionId: session.sessionId,
					title:
						typeof session.metadata?.title === "string"
							? session.metadata.title
							: undefined,
					status: session.status,
					workspaceRoot: session.workspaceRoot,
					updatedAt: parseSessionTimestamp(session.updatedAt),
				}),
			);
		await this.post({ type: "sessions", sessions });
	}

	private async attachSession(sessionId: string): Promise<void> {
		const trimmed = sessionId.trim();
		if (!trimmed) {
			await this.resetSession();
			return;
		}
		const host = await this.getSessionHost();
		const session = await host.get(trimmed);
		if (!session) {
			await this.post({
				type: "status",
				text: `Session ${trimmed} was not found.`,
			});
			return;
		}
		this.startEventStream(trimmed);
		await this.hubClient?.command("session.attach", {
			sessionId: trimmed,
			role: "participant",
			metadata: { source: "vscode-webview" },
		});
		const persistedMessages = (await host.readMessages(
			trimmed,
		)) as PersistedMessage[];
		this.startConfig = await this.buildStartConfigFromSession(session);
		await this.post({ type: "session_started", sessionId: trimmed });
		await this.post({
			type: "session_hydrated",
			sessionId: trimmed,
			status: session.status,
			providerId: session.provider,
			modelId: session.model,
			messages: mapPersistedMessagesToWebviewMessages(
				persistedMessages,
				session.metadata?.checkpoint,
			),
		});
		await this.post({
			type: "status",
			text:
				session.status === "running"
					? `Attached to ${trimmed} (running)`
					: `Attached to ${trimmed}`,
		});
		await this.refreshSessions();
	}

	private async updateSessionMetadata(
		sessionId: string,
		metadata: Record<string, unknown>,
	): Promise<void> {
		const trimmed = sessionId.trim();
		if (!trimmed) return;
		const host = await this.getSessionHost();
		await host.update(trimmed, { metadata });
		await this.refreshSessions();
	}

	private async deleteSession(sessionId: string): Promise<void> {
		const trimmed = sessionId.trim();
		if (!trimmed) return;
		const host = await this.getSessionHost();
		const deleted = await host.delete(trimmed);
		if (!deleted) {
			await this.post({
				type: "status",
				text: `Session ${trimmed} not found.`,
			});
			return;
		}
		if (this.sessionId === trimmed) {
			this.stopEventStream();
			this.sessionId = undefined;
			this.startConfig = undefined;
			await this.post({ type: "reset_done" });
		}
		await this.refreshSessions();
		await this.post({ type: "status", text: `Deleted session ${trimmed}` });
	}

	private async sendPrompt(
		prompt: string,
		config?: WebviewSendConfig,
		attachments?: { userImages?: string[] },
	): Promise<void> {
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt && (attachments?.userImages?.length ?? 0) === 0) {
			return;
		}
		if (this.sending) {
			await this.post({
				type: "status",
				text: "A turn is already in progress.",
			});
			return;
		}

		this.sending = true;
		try {
			await this.ensureSession(config);
			const host = await this.getSessionHost();
			const activeSessionId = this.sessionId as string;
			await host.send({
				sessionId: activeSessionId,
				prompt: trimmedPrompt,
				userImages: attachments?.userImages,
			});
			await this.refreshSessions();
		} catch (error) {
			await this.postError(error);
		} finally {
			this.sending = false;
		}
	}

	private buildExtensionContext(workspaceRoot: string, cwd: string) {
		return {
			client: { name: "cline-vscode", version },
			workspace: {
				rootPath: workspaceRoot,
				cwd,
				workspaceName: basename(cwd),
				ide: "VS Code",
				platform: os.platform(),
			},
			logger: this.logger,
			telemetry: this.telemetry,
		};
	}

	private async buildStartConfigFromSession(
		session: NonNullable<Awaited<ReturnType<ClineCore["get"]>>>,
	): Promise<StartConfig> {
		const mode: "act" | "plan" =
			session.metadata?.mode === "plan" ? "plan" : "act";
		const explicitSystemPrompt =
			typeof session.metadata?.systemPrompt === "string"
				? session.metadata.systemPrompt
				: undefined;
		const resolvedSystemPrompt = await this.resolveSystemPrompt(
			session.cwd,
			session.provider,
			explicitSystemPrompt,
			mode,
		);
		return {
			workspaceRoot: session.workspaceRoot,
			cwd: session.cwd,
			providerId: session.provider,
			modelId: session.model,
			mode,
			apiKey: "",
			systemPrompt: resolvedSystemPrompt,
			maxIterations:
				typeof session.metadata?.maxIterations === "number"
					? session.metadata.maxIterations
					: undefined,
			thinking: session.metadata?.thinking === true,
			enableTools: session.enableTools,
			enableSpawnAgent: session.enableSpawn,
			enableAgentTeams: session.enableTeams,
			teamName: session.teamName ?? "vscode-chat",
			missionLogIntervalSteps: 3,
			missionLogIntervalMs: 120000,
			checkpoint: { enabled: true },
			autoApproveTools:
				typeof session.metadata?.autoApproveTools === "boolean"
					? session.metadata.autoApproveTools
					: undefined,
			logger: this.logger,
			extensionContext: this.buildExtensionContext(
				session.workspaceRoot,
				session.cwd,
			),
		};
	}

	private async ensureSession(
		config?: WebviewSendConfig,
	): Promise<StartConfig> {
		const defaults = this.resolveWorkspaceDefaults();
		const providerId = Llms.normalizeProviderId(
			config?.provider?.trim() || "cline",
		);
		const modelId = config?.model?.trim() || "openai/gpt-5.4";
		const mode: "act" | "plan" = config?.mode === "plan" ? "plan" : "act";
		const normalizedMaxIterations =
			typeof config?.maxIterations === "number" && config.maxIterations > 0
				? Math.floor(config.maxIterations)
				: undefined;
		const resolvedSystemPrompt = await this.resolveSystemPrompt(
			defaults.cwd,
			providerId,
			config?.systemPrompt,
			mode,
		);
		const startConfig: StartConfig = {
			workspaceRoot: defaults.workspaceRoot,
			cwd: defaults.cwd,
			providerId,
			modelId,
			mode,
			apiKey: "",
			systemPrompt: resolvedSystemPrompt,
			maxIterations: normalizedMaxIterations,
			thinking: config?.thinking === true,
			enableTools: config?.enableTools !== false,
			enableSpawnAgent: config?.enableSpawn !== false,
			enableAgentTeams: config?.enableTeams === true,
			teamName: "vscode-chat",
			missionLogIntervalSteps: 3,
			missionLogIntervalMs: 120000,
			checkpoint: { enabled: true },
			autoApproveTools: config?.autoApproveTools !== false,
			logger: this.logger,
			extensionContext: this.buildExtensionContext(
				defaults.workspaceRoot,
				defaults.cwd,
			),
			extraTools: [createVsCodeTerminalTool(defaults.cwd)],
		};

		if (this.sessionId && this.startConfig) {
			if (areStartConfigsEqual(this.startConfig, startConfig)) {
				return this.startConfig;
			}
			await this.stopExistingSession();
		}

		const toolPolicies = createToolPolicies(startConfig);

		const host = await this.getSessionHost();
		const response = await host.start({
			interactive: true,
			config: startConfig,
			toolPolicies,
		});
		const sessionId = response.sessionId.trim();
		if (!sessionId) {
			throw new Error("core runtime returned an empty session id");
		}

		this.sessionId = sessionId;
		this.startConfig = startConfig;
		this.startEventStream(sessionId);
		await this.post({ type: "session_started", sessionId });
		await this.refreshSessions();
		return startConfig;
	}

	private async stopExistingSession(): Promise<void> {
		if (this.sessionId && this.host) {
			try {
				await this.host.stop(this.sessionId);
			} catch {
				// best-effort cleanup before starting a replacement session
			}
		}
		this.stopEventStream();
		this.sessionId = undefined;
		this.startConfig = undefined;
	}

	private startEventStream(sessionId: string): void {
		this.stopEventStream();
		this.sessionId = sessionId;
		this.stopSessionSubscription = this.hubClient?.subscribe((event) => {
			if (event.sessionId !== sessionId) return;
			void this.forwardSessionHubEvent(event as HubEventEnvelope);
		});
	}

	private async resolveSystemPrompt(
		cwd: string,
		providerId: string,
		explicitSystemPrompt?: string,
		mode: "act" | "plan" | "yolo" = "act",
	): Promise<string> {
		const metadata = await buildWorkspaceMetadata(cwd);
		return buildClineSystemPrompt({
			overridePrompt: explicitSystemPrompt,
			ide: "VS Code",
			mode,
			workspaceRoot: cwd,
			providerId,
			workspaceName: basename(cwd),
			metadata,
			platform:
				(typeof process !== "undefined" && process?.platform) || "unknown",
		});
	}

	private async abortTurn(): Promise<void> {
		if (!this.sessionId) return;
		try {
			const host = await this.getSessionHost();
			await host.abort(this.sessionId);
			await this.post({ type: "status", text: "Abort requested." });
		} catch (error) {
			await this.postError(error);
		}
	}

	private async forkSession(): Promise<void> {
		const forkedFromSessionId = this.sessionId;
		if (!forkedFromSessionId) {
			await this.post({
				type: "fork_error",
				text: "No active session to fork.",
			});
			return;
		}
		try {
			const host = await this.getSessionHost();
			const rawMessages = await host.readMessages(forkedFromSessionId);
			if (rawMessages.length === 0) {
				await this.post({
					type: "fork_error",
					text: "Cannot fork an empty session.",
				});
				return;
			}
			const sourceSession = await host.get(forkedFromSessionId);
			const checkpointMetadata = sourceSession?.metadata?.checkpoint;
			const forkMetadata: Record<string, unknown> = {
				...(sourceSession?.metadata ?? {}),
				fork: {
					forkedFromSessionId,
					forkedAt: new Date().toISOString(),
					source: sourceSession?.source ?? "vscode",
					...(checkpointMetadata !== undefined
						? { checkpoints: checkpointMetadata }
						: {}),
				},
			};
			const forkStartConfig = sourceSession
				? await this.buildStartConfigFromSession(sourceSession)
				: this.startConfig;
			if (!forkStartConfig) {
				throw new Error("Could not resolve start config for fork.");
			}
			await this.stopExistingSession();
			const response = await host.start({
				interactive: true,
				config: forkStartConfig,
				toolPolicies: createToolPolicies(forkStartConfig),
				initialMessages: rawMessages as import("@clinebot/llms").Message[],
				sessionMetadata: forkMetadata,
			});
			const newSessionId = response.sessionId.trim();
			if (!newSessionId) {
				throw new Error("Fork did not return a session id.");
			}
			const newSession = await host.get(newSessionId);
			this.sessionId = newSessionId;
			this.startConfig = forkStartConfig;
			this.startEventStream(newSessionId);
			await this.post({ type: "session_started", sessionId: newSessionId });
			await this.post({
				type: "session_hydrated",
				sessionId: newSessionId,
				status: newSession?.status,
				messages: mapPersistedMessagesToWebviewMessages(
					rawMessages as PersistedMessage[],
					newSession?.metadata?.checkpoint,
				),
			});
			await this.post({
				type: "fork_done",
				forkedFromSessionId,
				newSessionId,
			});
			await this.refreshSessions();
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			await this.post({ type: "fork_error", text });
		}
	}

	private async resetSession(): Promise<void> {
		await this.stopExistingSession();
		this.sending = false;
		await this.post({ type: "reset_done" });
		await this.refreshSessions();
	}

	private stopEventStream(): void {
		this.stopSessionSubscription?.();
		this.stopSessionSubscription = undefined;
	}

	private async getSessionHost(): Promise<ClineCore> {
		if (!this.host) {
			await this.ensureHub();
			const defaults = this.resolveWorkspaceDefaults();
			this.host = await ClineCore.create({
				backendMode: "hub",
				capabilities: this.createRuntimeCapabilities(),
				hub: {
					endpoint: this.hubUrl,
					authToken: this.hubAuthToken,
					clientType: "vscode",
					displayName: "VS Code",
					workspaceRoot: defaults.workspaceRoot,
					cwd: defaults.cwd,
				},
				telemetry: this.telemetry,
			});
			this.stopHostSubscription = this.host.subscribe(() => {});
		}
		return this.host;
	}

	private createRuntimeCapabilities(): RuntimeCapabilities {
		return createVsCodeRuntimeCapabilities({ ui: vscode.window });
	}

	private async restore(checkpointRunCount: number): Promise<void> {
		const sourceSessionId = this.sessionId;
		const startConfig = this.startConfig;
		if (!sourceSessionId || !startConfig) {
			await this.post({
				type: "error",
				text: "No active session to restore.",
			});
			return;
		}
		if (!Number.isInteger(checkpointRunCount) || checkpointRunCount < 1) {
			await this.post({ type: "error", text: "Invalid checkpoint run count." });
			return;
		}
		try {
			const host = await this.getSessionHost();
			const restored = await host.restore({
				sessionId: sourceSessionId,
				checkpointRunCount,
				cwd: startConfig.cwd || startConfig.workspaceRoot,
				restore: { messages: true, workspace: true },
				start: {
					interactive: true,
					config: startConfig,
					toolPolicies: createToolPolicies(startConfig),
				},
			});
			const newSessionId = restored.sessionId?.trim() ?? "";
			if (!newSessionId) {
				throw new Error("Checkpoint restore did not return a session id.");
			}
			const newSession = await host.get(newSessionId);
			await this.stopExistingSession();
			this.sessionId = newSessionId;
			this.startConfig = startConfig;
			this.startEventStream(newSessionId);
			await this.post({ type: "session_started", sessionId: newSessionId });
			await this.post({
				type: "session_hydrated",
				sessionId: newSessionId,
				status: newSession?.status,
				providerId: newSession?.provider,
				modelId: newSession?.model,
				messages: mapPersistedMessagesToWebviewMessages(
					(restored.messages ?? []) as PersistedMessage[],
					newSession?.metadata?.checkpoint,
				),
			});
			await this.post({
				type: "status",
				text: `Restored checkpoint ${checkpointRunCount}`,
			});
			await this.refreshSessions();
		} catch (error) {
			await this.postError(error);
		}
	}

	private async handleHubEvent(event: HubEventEnvelope): Promise<void> {
		const shouldRefreshSessions = REFRESH_SESSION_EVENTS.has(event.event);
		if (!this.sessionId || event.sessionId !== this.sessionId) {
			if (shouldRefreshSessions) {
				void this.refreshSessions().catch(() => undefined);
			}
			return;
		}
		if (!this.stopSessionSubscription) {
			await this.forwardSessionHubEvent(event);
		}
	}

	private async forwardSessionHubEvent(event: HubEventEnvelope): Promise<void> {
		if (!this.sessionId || event.sessionId !== this.sessionId) return;
		const payload = asRecord(event.payload);
		const shouldRefreshSessions = REFRESH_SESSION_EVENTS.has(event.event);

		switch (event.event) {
			case "assistant.delta":
				await this.post({
					type: "assistant_delta",
					text: String(payload?.text ?? ""),
				});
				return;
			case "reasoning.delta":
				await this.post({
					type: "reasoning_delta",
					text: String(payload?.text ?? ""),
					redacted: payload?.redacted === true,
				});
				return;
			case "tool.started": {
				const toolName =
					typeof payload?.toolName === "string" ? payload.toolName : "tool";
				await this.post({
					type: "tool_event",
					text: `Running ${toolName}...`,
					event: {
						toolCallId:
							typeof payload?.toolCallId === "string"
								? payload.toolCallId
								: undefined,
						toolName,
						status: "running",
						input: payload?.input,
					},
				});
				return;
			}
			case "tool.finished": {
				const toolName =
					typeof payload?.toolName === "string" ? payload.toolName : "tool";
				const error =
					typeof payload?.error === "string" ? payload.error : undefined;
				await this.post({
					type: "tool_event",
					text: error
						? `${toolName} failed: ${error}`
						: `${toolName} completed`,
					event: {
						toolCallId:
							typeof payload?.toolCallId === "string"
								? payload.toolCallId
								: undefined,
						toolName,
						status: error ? "failed" : "completed",
						output: payload?.output,
						error,
					},
				});
				return;
			}
			case "run.completed":
			case "run.failed": {
				const result = asRecord(payload?.result);
				await this.post({
					type: "turn_done",
					finishReason:
						typeof payload?.reason === "string"
							? payload.reason
							: event.event === "run.failed"
								? "error"
								: "completed",
					iterations:
						typeof result?.iterations === "number" ? result.iterations : 0,
					usage: asRecord(result?.usage) as
						| {
								inputTokens?: number;
								outputTokens?: number;
								cacheCreationInputTokens?: number;
								cacheReadInputTokens?: number;
								totalCost?: number;
						  }
						| undefined,
				});
				if (shouldRefreshSessions) {
					void this.refreshSessions().catch(() => undefined);
				}
				return;
			}
			case "run.aborted":
				await this.post({
					type: "turn_done",
					finishReason: "aborted",
					iterations: 0,
				});
				if (shouldRefreshSessions) {
					void this.refreshSessions().catch(() => undefined);
				}
				return;
		}
		if (shouldRefreshSessions) {
			void this.refreshSessions().catch(() => undefined);
		}
	}

	private async post(message: WebviewOutboundMessage): Promise<void> {
		await this.webview.postMessage(message);
	}

	private async postError(error: unknown): Promise<void> {
		const text = error instanceof Error ? error.message : String(error);
		await this.post({ type: "error", text });
	}
}

/**
 * Returns true if two StartConfigs represent the same session, meaning no
 * restart is needed when the webview sends a new config.
 *
 * For extensionContext, only the identity fields (client name and user
 * distinctId) are compared — logger and telemetry are object references that
 * are never meaningfully different between two calls for the same user, and
 * JSON.stringify is unsafe here because those objects contain functions and
 * may have circular references.
 */
function areStartConfigsEqual(a: StartConfig, b: StartConfig): boolean {
	return (
		a.providerId === b.providerId &&
		a.modelId === b.modelId &&
		a.cwd === b.cwd &&
		a.workspaceRoot === b.workspaceRoot &&
		a.systemPrompt === b.systemPrompt &&
		a.maxIterations === b.maxIterations &&
		a.thinking === b.thinking &&
		a.enableTools === b.enableTools &&
		a.enableSpawnAgent === b.enableSpawnAgent &&
		a.enableAgentTeams === b.enableAgentTeams &&
		a.teamName === b.teamName &&
		a.missionLogIntervalSteps === b.missionLogIntervalSteps &&
		a.missionLogIntervalMs === b.missionLogIntervalMs &&
		a.mode === b.mode &&
		a.apiKey === b.apiKey &&
		a.autoApproveTools === b.autoApproveTools &&
		a.extensionContext?.client?.name === b.extensionContext?.client?.name &&
		a.extensionContext?.user?.distinctId ===
			b.extensionContext?.user?.distinctId
	);
}

function createToolPolicies(config: StartConfig): Record<string, ToolPolicy> {
	return {
		"*": { autoApprove: config.autoApproveTools !== false },
	};
}

function createNonce(): string {
	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let nonce = "";
	for (let index = 0; index < 32; index += 1) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}

function createOutputChannelLogger(
	outputChannel: vscode.OutputChannel,
): BasicLogger {
	const write = (
		level: "debug" | "info" | "warn" | "error",
		message: string,
		metadata?: Record<string, unknown>,
	): void => {
		outputChannel.appendLine(
			`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${formatLogMetadata(metadata)}`,
		);
	};

	return {
		debug: (message, metadata) => write("debug", message, metadata),
		log: (message, metadata) => {
			const severity = metadata?.severity;
			const level =
				severity === "warn" ? "warn" : severity === "error" ? "error" : "info";
			const { severity: _s, ...rest } = metadata ?? {};
			write(level, message, Object.keys(rest).length > 0 ? rest : undefined);
		},
		error: (message, metadata) => write("error", message, metadata),
	};
}

function formatLogMetadata(metadata?: Record<string, unknown>): string {
	if (!metadata || Object.keys(metadata).length === 0) return "";
	try {
		return ` ${JSON.stringify(metadata)}`;
	} catch {
		return " [unserializable metadata]";
	}
}
