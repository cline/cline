import * as os from "node:os";
import { join } from "node:path";
import { getClineDefaultSystemPrompt } from "@clinebot/agents";
import {
	type BasicLogger,
	type ITelemetryService,
	LlmsModels as llmModels,
	LlmsProviders as llmProviders,
	ProviderSettingsManager,
	type RpcProviderModel,
	type ToolPolicy,
} from "@clinebot/core";
import {
	buildWorkspaceMetadata,
	createSessionHost,
	type SessionHost,
} from "@clinebot/core/node";
import { createConfiguredTelemetryService } from "@clinebot/core/telemetry/opentelemetry";
import {
	createClineTelemetryServiceConfig,
	createClineTelemetryServiceMetadata,
} from "@clinebot/shared";
import * as vscode from "vscode";
import { displayName, version } from "../package.json";
import type {
	WebviewInboundMessage,
	WebviewOutboundMessage,
} from "./webview-protocol";

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
};

type ProviderListItem = {
	id: string;
	name: string;
	enabled: boolean;
	defaultModelId?: string;
};

type LlmModelInfo = {
	name?: string;
	capabilities?: string[];
	thinkingConfig?: unknown;
};

class CoreChatWebviewController implements vscode.Disposable {
	private readonly webview: vscode.Webview;
	private readonly extensionUri: vscode.Uri;
	private readonly logger: BasicLogger;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly providerSettingsManager = new ProviderSettingsManager();
	private host: SessionHost | undefined;
	private stopSessionSubscription: (() => void) | undefined;
	private sessionId: string | undefined;
	private startConfig: StartConfig | undefined;
	private sending = false;
	private streamedAssistantText = "";
	private streamedReasoningText = "";
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
		if (message.type === "abort") {
			await this.abortTurn();
			return;
		}
		if (message.type === "reset") {
			await this.resetSession();
			return;
		}
		if (message.type === "send") {
			await this.sendPrompt(message.prompt, message.config);
		}
	}

	private async initialize(): Promise<void> {
		try {
			await this.getSessionHost();
			await this.post({
				type: "status",
				text: "Cline is Ready",
			});
			const defaults = this.resolveWorkspaceDefaults();
			await this.post({ type: "defaults", defaults });
			await this.loadProviders(defaults.provider);
		} catch (error) {
			await this.postError(error);
		}
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
		return {
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
		const models: RpcProviderModel[] = Object.entries(modelMap)
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
	): Promise<void> {
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
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
		this.streamedAssistantText = "";
		this.streamedReasoningText = "";
		try {
			await this.ensureSession(config);
			const host = await this.getSessionHost();
			const result = await host.send({
				sessionId: this.sessionId as string,
				prompt: trimmedPrompt,
			});
			this.emitRemainder(result?.text ?? "");
			await this.post({
				type: "turn_done",
				finishReason: result?.finishReason ?? "unknown",
				iterations: result?.iterations ?? 0,
				usage: result?.usage,
			});
		} catch (error) {
			await this.postError(error);
		} finally {
			this.sending = false;
		}
	}

	private emitRemainder(fullText: string): void {
		if (!fullText) {
			return;
		}
		if (fullText.startsWith(this.streamedAssistantText)) {
			const remainder = fullText.slice(this.streamedAssistantText.length);
			if (remainder) {
				this.streamedAssistantText = fullText;
				void this.post({ type: "assistant_delta", text: remainder });
			}
			return;
		}
		if (fullText !== this.streamedAssistantText) {
			this.streamedAssistantText = fullText;
			void this.post({ type: "assistant_delta", text: fullText });
		}
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
		const modelId = config?.model?.trim() || "openai/gpt-5.3-codex";
		const normalizedMaxIterations =
			typeof config?.maxIterations === "number" && config.maxIterations > 0
				? Math.floor(config.maxIterations)
				: undefined;
		const resolvedSystemPrompt = await this.resolveSystemPrompt(
			defaults.cwd,
			providerId,
			config?.systemPrompt,
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
		this.streamedAssistantText = "";
		this.streamedReasoningText = "";
	}

	private startEventStream(sessionId: string): void {
		this.stopEventStream();
		const host = this.host;
		if (!host) {
			return;
		}
		this.stopSessionSubscription = host.subscribe((event) => {
			if (
				event.type !== "agent_event" ||
				event.payload.sessionId !== sessionId
			) {
				return;
			}

			const agentEvent = event.payload.event;
			if (
				agentEvent.type === "content_start" &&
				agentEvent.contentType === "text" &&
				typeof agentEvent.text === "string" &&
				agentEvent.text.length > 0
			) {
				this.streamedAssistantText += agentEvent.text;
				void this.post({ type: "assistant_delta", text: agentEvent.text });
				return;
			}

			if (
				agentEvent.type === "content_start" &&
				agentEvent.contentType === "reasoning"
			) {
				if (agentEvent.redacted && !agentEvent.reasoning) {
					void this.post({ type: "reasoning_delta", text: "", redacted: true });
					return;
				}
				if (
					typeof agentEvent.reasoning === "string" &&
					agentEvent.reasoning.length > 0
				) {
					this.streamedReasoningText += agentEvent.reasoning;
					void this.post({
						type: "reasoning_delta",
						text: agentEvent.reasoning,
						redacted: agentEvent.redacted,
					});
					return;
				}
			}

			if (
				agentEvent.type === "content_end" &&
				agentEvent.contentType === "reasoning" &&
				typeof agentEvent.reasoning === "string" &&
				agentEvent.reasoning !== this.streamedReasoningText
			) {
				const text = agentEvent.reasoning.startsWith(this.streamedReasoningText)
					? agentEvent.reasoning.slice(this.streamedReasoningText.length)
					: agentEvent.reasoning;
				this.streamedReasoningText = agentEvent.reasoning;
				void this.post({ type: "reasoning_delta", text });
				return;
			}

			if (
				agentEvent.type === "content_start" &&
				agentEvent.contentType === "tool"
			) {
				void this.post({
					type: "tool_event",
					text: `Running ${agentEvent.toolName ?? "tool"}...`,
					event: {
						toolCallId: agentEvent.toolCallId,
						toolName: agentEvent.toolName,
						status: "running",
						input: agentEvent.input,
					},
				});
				return;
			}

			if (
				agentEvent.type === "content_end" &&
				agentEvent.contentType === "tool"
			) {
				void this.post({
					type: "tool_event",
					text: agentEvent.error
						? `${agentEvent.toolName ?? "tool"} failed: ${agentEvent.error}`
						: `${agentEvent.toolName ?? "tool"} completed`,
					event: {
						toolCallId: agentEvent.toolCallId,
						toolName: agentEvent.toolName,
						status: agentEvent.error ? "failed" : "completed",
						output: agentEvent.output,
						error: agentEvent.error,
					},
				});
			}
		});
	}

	private async resolveSystemPrompt(
		cwd: string,
		providerId: string,
		explicitSystemPrompt?: string,
	): Promise<string> {
		const shouldAppendWorkspaceMetadata = providerId === "cline";
		const workspaceMetadata = shouldAppendWorkspaceMetadata
			? await buildWorkspaceMetadata(cwd)
			: "";
		const explicit = explicitSystemPrompt?.trim();
		if (explicit) {
			if (
				shouldAppendWorkspaceMetadata &&
				!explicit.includes("# Workspace Configuration")
			) {
				return `${explicit}\n\n${workspaceMetadata}`;
			}
			return explicit;
		}
		return getClineDefaultSystemPrompt(
			"VS Code",
			cwd,
			shouldAppendWorkspaceMetadata ? workspaceMetadata : "",
		);
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

	private async resetSession(): Promise<void> {
		await this.stopExistingSession();
		this.sending = false;
		await this.post({ type: "reset_done" });
	}

	private stopEventStream(): void {
		this.stopSessionSubscription?.();
		this.stopSessionSubscription = undefined;
	}

	private async getSessionHost(): Promise<SessionHost> {
		if (!this.host) {
			this.host = await createSessionHost({
				backendMode: "local",
				telemetry: this.telemetry,
			});
		}
		return this.host;
	}

	private async post(message: WebviewOutboundMessage): Promise<void> {
		await this.webview.postMessage(message);
	}

	private async postError(error: unknown): Promise<void> {
		const text = error instanceof Error ? error.message : String(error);
		await this.post({ type: "error", text });
	}
}

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
		a.apiKey === b.apiKey
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
		info: (message, metadata) => write("info", message, metadata),
		warn: (message, metadata) => write("warn", message, metadata),
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
