import { spawn } from "node:child_process";
import * as os from "node:os";
import { basename, join } from "node:path";
import {
	type BasicLogger,
	buildWorkspaceMetadata,
	ClineCore,
	createConfiguredTelemetryService,
	type ITelemetryService,
	Llms,
	NodeHubClient,
	type ProviderModel,
	ProviderSettingsManager,
	probeHubServer,
	readHubDiscovery,
	resolveSharedHubOwnerContext,
	type ToolPolicy,
} from "@clinebot/core";
import {
	buildClineSystemPrompt,
	createClineTelemetryServiceConfig,
	createClineTelemetryServiceMetadata,
} from "@clinebot/shared";
import * as vscode from "vscode";
import { displayName, version } from "../package.json";
import type {
	WebviewChatMessage,
	WebviewInboundMessage,
	WebviewOutboundMessage,
	WebviewSessionSummary,
} from "./webview-protocol";

const llmModels = Llms;
const llmProviders = Llms;

export function activate(context: vscode.ExtensionContext): void {
	const outputChannel = vscode.window.createOutputChannel("Cline");
	const sidebarProvider = new ClineChatViewProvider(
		context.extensionUri,
		outputChannel,
	);
	context.subscriptions.push(
		outputChannel,
		vscode.window.registerWebviewViewProvider(
			"clineVscode.chatView",
			sidebarProvider,
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
	);

	const openChat = vscode.commands.registerCommand(
		"clineVscode.openChat",
		() => {
			const localResourceRoots = [
				vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
			];
			const panel = vscode.window.createWebviewPanel(
				"clineChat",
				"Cline Chat",
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					localResourceRoots,
				},
			);
			const controller = new CoreChatWebviewController(
				panel.webview,
				context.extensionUri,
				outputChannel,
				panel.onDidDispose,
			);
			context.subscriptions.push(controller);
		},
	);
	context.subscriptions.push(openChat);
}

export function deactivate(): void {
	// no-op; webview controllers are disposed by VS Code subscriptions
}

class ClineChatViewProvider implements vscode.WebviewViewProvider {
	private readonly extensionUri: vscode.Uri;
	private readonly outputChannel: vscode.OutputChannel;

	constructor(extensionUri: vscode.Uri, outputChannel: vscode.OutputChannel) {
		this.extensionUri = extensionUri;
		this.outputChannel = outputChannel;
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
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
	mode: "act" | "plan";
	apiKey: string;
	logger: BasicLogger;
	extensionContext?: import("@clinebot/shared").ExtensionContext;
};

type ProviderListItem = {
	id: string;
	name: string;
	enabled: boolean;
	defaultModelId?: string;
};

type HubSessionRecord = {
	sessionId: string;
	status?: string;
	workspaceRoot?: string;
	updatedAt?: number;
	metadata?: Record<string, unknown>;
};

type HubEventEnvelope = {
	event: string;
	sessionId?: string;
	payload?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

type LlmModelInfo = {
	name?: string;
	capabilities?: string[];
	thinkingConfig?: unknown;
};

function stringifyContent(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value == null) {
		return "";
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function mapPersistedMessagesToWebviewMessages(
	messages: Array<{
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
	}>,
): WebviewChatMessage[] {
	return messages.flatMap((message, messageIndex) => {
		const textParts: string[] = [];
		const reasoningParts: string[] = [];
		let reasoningRedacted = false;
		const toolEvents = new Map<
			string,
			NonNullable<WebviewChatMessage["toolEvents"]>[number]
		>();

		if (typeof message.content === "string") {
			const text = message.content.trim();
			if (text) {
				textParts.push(text);
			}
		}

		for (const part of Array.isArray(message.content) ? message.content : []) {
			switch (part.type) {
				case "text":
					if (part.text.trim()) {
						textParts.push(part.text.trim());
					}
					break;
				case "reasoning":
					if (part.text.trim()) {
						reasoningParts.push(part.text);
					}
					reasoningRedacted = reasoningRedacted || part.redacted === true;
					break;
				case "tool-call":
					toolEvents.set(part.toolCallId, {
						id: `${message.id ?? messageIndex}:${part.toolCallId}`,
						toolCallId: part.toolCallId,
						name: part.toolName,
						text: `Running ${part.toolName}...`,
						state: "input-available",
						input: part.input,
					});
					break;
				case "tool-result": {
					const existing = toolEvents.get(part.toolCallId);
					toolEvents.set(part.toolCallId, {
						id:
							existing?.id ??
							`${message.id ?? messageIndex}:${part.toolCallId}`,
						toolCallId: part.toolCallId,
						name: part.toolName,
						text: part.isError
							? `${part.toolName} failed`
							: `${part.toolName} completed`,
						state: part.isError ? "output-error" : "output-available",
						input: existing?.input,
						output: part.output,
						error: part.isError ? stringifyContent(part.output) : undefined,
					});
					break;
				}
			}
		}

		const text = textParts.join("\n");
		const toolEventList = [...toolEvents.values()];
		if (!text && reasoningParts.length === 0 && toolEventList.length === 0) {
			return [];
		}

		return [
			{
				id: message.id || `history-${messageIndex}`,
				role:
					message.role === "user"
						? "user"
						: message.role === "assistant"
							? "assistant"
							: "meta",
				text,
				reasoning:
					reasoningParts.length > 0 ? reasoningParts.join("\n") : undefined,
				reasoningRedacted: reasoningRedacted || undefined,
				toolEvents: toolEventList.length > 0 ? toolEventList : undefined,
			},
		];
	});
}

class CoreChatWebviewController implements vscode.Disposable {
	private static readonly SESSION_REFRESH_INTERVAL_MS = 4_000;
	private readonly webview: vscode.Webview;
	private readonly extensionUri: vscode.Uri;
	private readonly logger: BasicLogger;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly providerSettingsManager = new ProviderSettingsManager();
	private host: ClineCore | undefined;
	private hubClient: NodeHubClient | undefined;
	private stopHostSubscription: (() => void) | undefined;
	private stopSessionRefreshInterval: (() => void) | undefined;
	private stopSessionSubscription: (() => void) | undefined;
	private sessionId: string | undefined;
	private startConfig: StartConfig | undefined;
	private hubUrl: string | undefined;
	private sending = false;
	private telemetry: ITelemetryService | undefined;

	constructor(
		webview: vscode.Webview,
		extensionUri: vscode.Uri,
		outputChannel: vscode.OutputChannel,
		onDidDispose?: vscode.Event<void>,
	) {
		this.webview = webview;
		this.extensionUri = extensionUri;
		this.logger = createOutputChannelLogger(outputChannel);
		this.disposables.push(
			this.webview.onDidReceiveMessage((message: WebviewInboundMessage) => {
				void this.handleMessage(message);
			}),
		);
		if (onDidDispose) {
			this.disposables.push(
				onDidDispose(() => {
					this.dispose();
				}),
			);
		}

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
			void this.host.stop(this.sessionId).catch(() => {
				// best-effort cleanup
			});
		}
		void this.host?.dispose("vscode_webview_dispose").catch(() => {
			// best-effort cleanup
		});
		this.host = undefined;
		this.sessionId = undefined;
		this.startConfig = undefined;
		while (this.disposables.length > 0) {
			const disposable = this.disposables.pop();
			disposable?.dispose();
		}
	}

	private async handleMessage(message: WebviewInboundMessage): Promise<void> {
		if (message.type === "ready") {
			await this.initialize();
			return;
		}
		if (message.type === "loadModels") {
			await this.loadModels(message.providerId);
			return;
		}
		if (message.type === "attachSession") {
			await this.attachSession(message.sessionId);
			return;
		}
		if (message.type === "deleteSession") {
			await this.deleteSession(message.sessionId);
			return;
		}
		if (message.type === "updateSessionMetadata") {
			await this.updateSessionMetadata(message.sessionId, message.metadata);
			return;
		}
		if (message.type === "abort") {
			await this.abortTurn();
			return;
		}
		if (message.type === "reset") {
			await this.resetSession();
			return;
		}
		if (message.type === "forkSession") {
			await this.forkSession();
			return;
		}
		if (message.type === "send") {
			await this.sendPrompt(
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
			await this.post({
				type: "status",
				text: "Cline is Ready",
			});
			const defaults = this.resolveWorkspaceDefaults();
			await this.post({ type: "defaults", defaults });
			await this.loadProviders(defaults.provider);
			await this.refreshSessions();
			if (!this.stopSessionRefreshInterval) {
				const interval = setInterval(() => {
					void this.refreshSessions().catch(() => undefined);
				}, CoreChatWebviewController.SESSION_REFRESH_INTERVAL_MS);
				this.stopSessionRefreshInterval = () => {
					clearInterval(interval);
				};
			}
		} catch (error) {
			await this.postError(error);
		}
	}

	private async ensureHub(): Promise<void> {
		const defaults = this.resolveWorkspaceDefaults();
		if (this.hubClient && this.hubUrl) {
			try {
				await this.hubClient.connect();
				return;
			} catch {
				this.hubClient.close();
				this.hubClient = undefined;
				this.hubUrl = undefined;
			}
		}
		const owner = resolveSharedHubOwnerContext();
		if (this.hubUrl) {
			const healthy = await probeHubServer(this.hubUrl);
			if (healthy?.url) {
				this.hubUrl = healthy.url;
			} else {
				this.hubUrl = undefined;
			}
		}
		if (!this.hubUrl) {
			const discovery = await readHubDiscovery(owner.discoveryPath);
			if (discovery?.url) {
				const healthy = await probeHubServer(discovery.url);
				if (healthy?.url) {
					this.hubUrl = healthy.url;
				}
			}
		}
		if (!this.hubUrl) {
			const daemonScriptPath = join(
				this.extensionUri.fsPath,
				"dist",
				"hub-daemon.js",
			);
			const payload = Buffer.from(
				JSON.stringify({
					workspaceRoot: defaults.workspaceRoot,
					cwd: defaults.cwd,
					systemPrompt: "",
				}),
				"utf8",
			).toString("base64");
			const child = spawn(process.execPath, [daemonScriptPath, payload], {
				cwd: this.extensionUri.fsPath,
				detached: true,
				stdio: "ignore",
				env: process.env,
			});
			child.unref();

			const deadline = Date.now() + 8_000;
			while (Date.now() < deadline) {
				const nextDiscovery = await readHubDiscovery(owner.discoveryPath);
				if (nextDiscovery?.url) {
					const healthy = await probeHubServer(nextDiscovery.url);
					if (healthy?.url) {
						this.hubUrl = healthy.url;
						break;
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
		}
		if (!this.hubUrl) {
			throw new Error("No compatible hub runtime is available.");
		}
		this.hubClient = new NodeHubClient({
			url: this.hubUrl,
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

	private async initializeWebview(): Promise<void> {
		try {
			this.webview.html = await this.getWebviewHtml();
		} catch (error) {
			await this.postError(error);
		}
	}

	private async getWebviewHtml(): Promise<string> {
		const devServerUrl = process.env.VITE_DEV_SERVER_URL;
		if (devServerUrl) {
			return this.getDevWebviewHtml(devServerUrl);
		}
		return this.getProductionWebviewHtml();
	}

	private getDevWebviewHtml(devServerUrl: string): string {
		const host = new URL(devServerUrl).host;
		const csp = [
			"default-src 'none'",
			`img-src ${this.webview.cspSource} data: ${devServerUrl}`,
			`style-src ${this.webview.cspSource} 'unsafe-inline' ${devServerUrl}`,
			`font-src ${this.webview.cspSource} ${devServerUrl}`,
			`script-src 'unsafe-inline' ${devServerUrl}`,
			`connect-src ${devServerUrl} ws://${host} ws://localhost:${new URL(devServerUrl).port}`,
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
		const webview = this.webview;
		const distDir = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
		const indexPath = join(distDir.fsPath, "index.html");
		const nonce = createNonce();
		let html = await vscode.workspace.fs
			.readFile(vscode.Uri.file(indexPath))
			.then((buffer) => Buffer.from(buffer).toString("utf8"));

		html = html.replace(
			/<(script|link)([^>]+?(?:src|href))="([^"]+)"([^>]*)>/g,
			(_match, tag, attrPrefix, assetPath, suffix) => {
				if (
					assetPath.startsWith("http://") ||
					assetPath.startsWith("https://") ||
					assetPath.startsWith("data:")
				) {
					return `<${tag}${attrPrefix}="${assetPath}"${suffix}>`;
				}
				const normalizedAssetPath = assetPath.replace(/^\.?\//, "");
				const assetUri = webview.asWebviewUri(
					vscode.Uri.joinPath(distDir, normalizedAssetPath),
				);
				const nonceAttr = tag === "script" ? ` nonce="${nonce}"` : "";
				return `<${tag}${nonceAttr}${attrPrefix}="${assetUri.toString()}"${suffix}>`;
			},
		);

		const csp = [
			"default-src 'none'",
			`img-src ${webview.cspSource} data:`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`font-src ${webview.cspSource}`,
			// Allow the nonce-gated entry module and subsequent same-webview chunk loads.
			`script-src ${webview.cspSource} 'nonce-${nonce}'`,
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
		const lastUsedProviderSettings =
			this.providerSettingsManager.getLastUsedProviderSettings();
		return {
			provider: lastUsedProviderSettings?.provider,
			model: lastUsedProviderSettings?.model,
			workspaceRoot: cwd,
			cwd,
		};
	}

	private async loadProviders(preferredProvider?: string): Promise<void> {
		const state = this.providerSettingsManager.read();
		const ids = llmModels
			.getProviderIds()
			.sort((a: string, b: string) => a.localeCompare(b));
		const providers: ProviderListItem[] = (
			await Promise.all(
				ids.map(async (id: string) => {
					const info = await llmModels.getProvider(id);
					return {
						id,
						name: info?.name ?? id,
						enabled: Boolean(state.providers[id]?.settings),
						defaultModelId: info?.defaultModelId,
					};
				}),
			)
		).filter((provider: ProviderListItem) => provider.enabled);
		await this.post({ type: "providers", providers });

		const selected =
			(preferredProvider &&
				providers.find(
					(item: ProviderListItem) => item.id === preferredProvider,
				)) ||
			providers[0];
		if (selected) {
			await this.loadModels(selected.id);
		}
	}

	private async loadModels(providerId: string): Promise<void> {
		const provider = providerId.trim();
		if (!provider) {
			return;
		}
		const modelMap = (await llmModels.getModelsForProvider(provider)) as Record<
			string,
			LlmModelInfo
		>;
		const models: ProviderModel[] = Object.entries(modelMap)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([modelId, info]: [string, LlmModelInfo]) => ({
				id: modelId,
				name: info.name ?? modelId,
				supportsAttachments: info.capabilities?.includes("files"),
				supportsThinking:
					Boolean(info.thinkingConfig) ||
					info.capabilities?.includes("reasoning"),
				supportsVision: info.capabilities?.includes("images"),
			}));
		await this.post({
			type: "models",
			providerId: provider,
			models,
		});
	}

	private async refreshSessions(): Promise<void> {
		if (!this.hubClient) {
			return;
		}
		const reply = await this.hubClient.command("session.list");
		const sessions = (
			(reply.payload?.sessions as HubSessionRecord[] | undefined) ?? []
		)
			.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
			.map(
				(session): WebviewSessionSummary => ({
					sessionId: session.sessionId,
					title:
						typeof session.metadata?.title === "string"
							? session.metadata.title
							: undefined,
					status: session.status,
					workspaceRoot: session.workspaceRoot,
					updatedAt: session.updatedAt,
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
		const persistedMessages = (await host.readMessages(trimmed)) as Parameters<
			typeof mapPersistedMessagesToWebviewMessages
		>[0];
		this.startConfig = await this.buildStartConfigFromSession(session);
		await this.post({ type: "session_started", sessionId: trimmed });
		await this.post({
			type: "session_hydrated",
			sessionId: trimmed,
			status: session.status,
			providerId: session.provider,
			modelId: session.model,
			messages: mapPersistedMessagesToWebviewMessages(persistedMessages),
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
		if (!trimmed) {
			return;
		}
		const host = await this.getSessionHost();
		await host.update(trimmed, { metadata });
		await this.refreshSessions();
	}

	private async deleteSession(sessionId: string): Promise<void> {
		const trimmed = sessionId.trim();
		if (!trimmed) {
			return;
		}
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
		config?: {
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
		},
		attachments?: {
			userImages?: string[];
		},
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
			await host.send({
				sessionId: this.sessionId as string,
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

	private async buildStartConfigFromSession(
		session: NonNullable<Awaited<ReturnType<ClineCore["get"]>>>,
	): Promise<StartConfig> {
		const resolvedSystemPrompt = await this.resolveSystemPrompt(
			session.cwd,
			session.provider,
			typeof session.metadata?.systemPrompt === "string"
				? session.metadata.systemPrompt
				: undefined,
			session.metadata?.mode === "plan" ? "plan" : "act",
		);
		return {
			workspaceRoot: session.workspaceRoot,
			cwd: session.cwd,
			providerId: session.provider,
			modelId: session.model,
			mode: session.metadata?.mode === "plan" ? "plan" : "act",
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
			logger: this.logger,
			extensionContext: {
				client: { name: "cline-vscode", version },
				workspace: {
					rootPath: session.workspaceRoot,
					cwd: session.cwd,
					workspaceName: basename(session.cwd),
					ide: "VS Code",
					platform: os.platform(),
				},
				logger: this.logger,
				telemetry: this.telemetry,
			},
		};
	}

	private async ensureSession(config?: {
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
	}): Promise<StartConfig> {
		const defaults = this.resolveWorkspaceDefaults();
		const providerId = llmProviders.normalizeProviderId(
			config?.provider?.trim() || "cline",
		);
		const modelId = config?.model?.trim() || "openai/gpt-5.4";
		const normalizedMaxIterations =
			typeof config?.maxIterations === "number" && config.maxIterations > 0
				? Math.floor(config.maxIterations)
				: undefined;
		const resolvedSystemPrompt = await this.resolveSystemPrompt(
			defaults.cwd,
			providerId,
			config?.systemPrompt,
			config?.mode,
		);
		const startConfig: StartConfig = {
			workspaceRoot: defaults.workspaceRoot,
			cwd: defaults.cwd,
			providerId,
			modelId,
			mode: config?.mode === "plan" ? "plan" : "act",
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
			logger: this.logger,
			extensionContext: {
				client: { name: "cline-vscode", version },
				workspace: {
					rootPath: defaults.workspaceRoot,
					cwd: defaults.cwd,
					workspaceName: basename(defaults.cwd),
					ide: "VS Code",
					platform: os.platform(),
				},
				logger: this.logger,
				telemetry: this.telemetry,
			},
		};

		if (this.sessionId && this.startConfig) {
			if (areStartConfigsEqual(this.startConfig, startConfig)) {
				return this.startConfig;
			}
			await this.stopExistingSession();
		}

		const toolPolicies: Record<string, ToolPolicy> = {
			"*": {
				autoApprove: config?.autoApproveTools !== false,
			},
		};

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
			if (event.sessionId !== sessionId) {
				return;
			}
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
		if (!this.sessionId) {
			return;
		}
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
			// Read the messages from the source session — fails fast if empty.
			const rawMessages = await host.readMessages(forkedFromSessionId);
			if (rawMessages.length === 0) {
				await this.post({
					type: "fork_error",
					text: "Cannot fork an empty session.",
				});
				return;
			}
			// Retrieve the session record to copy checkpoint metadata.
			const sourceSession = await host.get(forkedFromSessionId);
			const checkpointMetadata = sourceSession?.metadata?.checkpoint;
			const forkMetadata: Record<string, unknown> = {
				fork: {
					forkedFromSessionId,
					forkedAt: new Date().toISOString(),
					source: sourceSession?.source ?? "vscode",
					...(checkpointMetadata !== undefined
						? { checkpoints: checkpointMetadata }
						: {}),
				},
			};
			// Carry forward any other metadata fields (e.g. title, totalCost).
			if (sourceSession?.metadata) {
				for (const [key, value] of Object.entries(sourceSession.metadata)) {
					if (key !== "fork") {
						forkMetadata[key] = value;
					}
				}
			}
			// Stop the current session before spawning the fork.
			await this.stopExistingSession();
			if (!this.startConfig) {
				throw new Error("Could not resolve start config for fork.");
			}
			const toolPolicies: Record<string, import("@clinebot/core").ToolPolicy> =
				{ "*": { autoApprove: true } };
			const response = await host.start({
				interactive: true,
				config: this.startConfig,
				toolPolicies,
				initialMessages: rawMessages as import("@clinebot/llms").Message[],
				sessionMetadata: forkMetadata,
			});
			const newSessionId = response.sessionId.trim();
			if (!newSessionId) {
				throw new Error("Fork did not return a session id.");
			}
			this.sessionId = newSessionId;
			this.startEventStream(newSessionId);
			await this.post({ type: "session_started", sessionId: newSessionId });
			const forkMessages = mapPersistedMessagesToWebviewMessages(
				rawMessages as Parameters<
					typeof mapPersistedMessagesToWebviewMessages
				>[0],
			);
			await this.post({
				type: "session_hydrated",
				sessionId: newSessionId,
				messages: forkMessages,
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
			this.host = await ClineCore.create({
				backendMode: "hub",
				hub: {
					endpoint: this.hubUrl,
					clientType: "vscode",
					displayName: "VS Code",
					workspaceRoot: this.resolveWorkspaceDefaults().workspaceRoot,
					cwd: this.resolveWorkspaceDefaults().cwd,
				},
				telemetry: this.telemetry,
			});
			this.stopHostSubscription = this.host.subscribe(() => {});
		}
		return this.host;
	}

	private async handleHubEvent(event: HubEventEnvelope): Promise<void> {
		const shouldRefreshSessions =
			event.event === "session.created" ||
			event.event === "session.updated" ||
			event.event === "session.attached" ||
			event.event === "session.detached" ||
			event.event === "run.started" ||
			event.event === "run.completed" ||
			event.event === "run.aborted";
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
		const payload = asRecord(event.payload);
		const shouldRefreshSessions =
			event.event === "session.created" ||
			event.event === "session.updated" ||
			event.event === "session.attached" ||
			event.event === "session.detached" ||
			event.event === "run.started" ||
			event.event === "run.completed" ||
			event.event === "run.aborted";
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
			case "tool.started":
				await this.post({
					type: "tool_event",
					text: `Running ${String(payload?.toolName ?? "tool")}...`,
					event: {
						toolCallId:
							typeof payload?.toolCallId === "string"
								? payload.toolCallId
								: undefined,
						toolName:
							typeof payload?.toolName === "string" ? payload.toolName : "tool",
						status: "running",
						input: payload?.input,
					},
				});
				return;
			case "tool.finished":
				await this.post({
					type: "tool_event",
					text:
						typeof payload?.error === "string"
							? `${String(payload?.toolName ?? "tool")} failed: ${payload.error}`
							: `${String(payload?.toolName ?? "tool")} completed`,
					event: {
						toolCallId:
							typeof payload?.toolCallId === "string"
								? payload.toolCallId
								: undefined,
						toolName:
							typeof payload?.toolName === "string" ? payload.toolName : "tool",
						status: typeof payload?.error === "string" ? "failed" : "completed",
						output: payload?.output,
						error:
							typeof payload?.error === "string" ? payload.error : undefined,
					},
				});
				return;
			case "run.completed":
				await this.post({
					type: "turn_done",
					finishReason:
						typeof payload?.reason === "string" ? payload.reason : "completed",
					iterations:
						typeof payload?.result === "object" &&
						payload.result &&
						typeof (payload.result as Record<string, unknown>).iterations ===
							"number"
							? ((payload.result as Record<string, unknown>)
									.iterations as number)
							: 0,
					usage:
						typeof payload?.result === "object" &&
						payload.result &&
						typeof (payload.result as Record<string, unknown>).usage ===
							"object"
							? ((payload.result as Record<string, unknown>).usage as {
									inputTokens?: number;
									outputTokens?: number;
									cacheCreationInputTokens?: number;
									cacheReadInputTokens?: number;
									totalCost?: number;
								})
							: undefined,
				});
				if (shouldRefreshSessions) {
					void this.refreshSessions().catch(() => undefined);
				}
				return;
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
		a.extensionContext?.client?.name === b.extensionContext?.client?.name &&
		a.extensionContext?.user?.distinctId ===
			b.extensionContext?.user?.distinctId
	);
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
		const suffix = formatLogMetadata(metadata);
		outputChannel.appendLine(
			`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${suffix}`,
		);
	};

	return {
		debug: (message, metadata) => write("debug", message, metadata),
		log: (message, metadata) => {
			const level =
				metadata?.severity === "warn"
					? ("warn" as const)
					: metadata?.severity === "error"
						? ("error" as const)
						: ("info" as const);
			const { severity: _s, ...rest } = metadata ?? {};
			write(level, message, Object.keys(rest).length > 0 ? rest : undefined);
		},
		error: (message, metadata) => write("error", message, metadata),
	};
}

function formatLogMetadata(metadata?: Record<string, unknown>): string {
	if (!metadata || Object.keys(metadata).length === 0) {
		return "";
	}
	try {
		return ` ${JSON.stringify(metadata)}`;
	} catch {
		return " [unserializable metadata]";
	}
}
