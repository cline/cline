/**
 * Community SDK Handlers
 *
 * Consolidated handlers for:
 * - Codex CLI (`openai-codex`)
 * - Claude Code (`claude-code`)
 * - OpenCode (`opencode`)
 * - Mistral (`mistral`)
 * - Dify (`dify`)
 * - SAP AI Core (`sapaicore`)
 */

import type { EmitAiSdkStreamOptions } from "./ai-sdk-community";
import { AiSdkProviderHandler } from "./ai-sdk-provider-base";

let zodCompatPatched = false;

async function ensureCodexZodCompatibility(): Promise<void> {
	if (zodCompatPatched) {
		return;
	}
	zodCompatPatched = true;

	try {
		const zodModule = (await import("zod")) as Record<string, unknown>;
		const z = (zodModule.z ?? zodModule) as Record<string, unknown>;
		const objectFactory = z.object as
			| ((shape?: Record<string, unknown>) => {
					refine?: (check: (value: unknown) => boolean) => unknown;
			  })
			| undefined;
		if (typeof objectFactory !== "function") {
			return;
		}

		const refined = objectFactory({}).refine?.(() => true) as
			| { passthrough?: unknown }
			| undefined;
		if (!refined || typeof refined.passthrough === "function") {
			return;
		}

		const proto = Object.getPrototypeOf(refined) as
			| { passthrough?: unknown }
			| undefined;
		if (!proto || typeof proto.passthrough === "function") {
			return;
		}

		Object.defineProperty(proto, "passthrough", {
			value(this: unknown) {
				return this;
			},
			configurable: true,
			enumerable: false,
			writable: true,
		});
	} catch {
		// Best-effort compatibility shim for codex-cli provider with zod v3.
	}
}

function isLikelyOpenAIApiKey(value: string): boolean {
	return value.startsWith("sk-");
}

function shouldDisableAiSdkWarnings(): boolean {
	const raw = process.env.AI_SDK_LOG_WARNINGS?.trim().toLowerCase();
	return raw === "0" || raw === "false" || raw === "off";
}

function resolveOpenCodeModelId(modelId: string): string {
	if (modelId.includes("/")) {
		return modelId;
	}
	return `openai/${modelId}`;
}

export class CodexHandler extends AiSdkProviderHandler {
	protected getProviderDefinition() {
		return {
			moduleName: "ai-sdk-provider-codex-cli",
			createExportName: "createCodexCli",
			providerExportName: "codexCli",
			missingDependencyError:
				"Codex provider requires `ai-sdk-provider-codex-cli` and the Codex CLI at runtime. Install dependencies and run `codex` to authenticate.",
		};
	}

	protected getDefaultModelId(): string {
		return "gpt-5.3-codex";
	}

	protected async beforeLoadProviderModule(): Promise<void> {
		await ensureCodexZodCompatibility();
	}

	protected getProviderCreateOptions(): Record<string, unknown> {
		const codexOptions = this.config.codex ?? {};
		const defaultSettings: Record<string, unknown> = {
			...(codexOptions.defaultSettings ?? {}),
		};

		if (
			this.config.reasoningEffort &&
			defaultSettings.reasoningEffort === undefined
		) {
			defaultSettings.reasoningEffort = this.config.reasoningEffort;
		} else if (
			this.config.thinking &&
			defaultSettings.reasoningEffort === undefined
		) {
			defaultSettings.reasoningEffort = "medium";
		}

		const apiKey = this.config.apiKey?.trim();
		const hasOAuthAccessToken =
			typeof this.config.accessToken === "string" &&
			this.config.accessToken.trim().length > 0;
		if (apiKey && !hasOAuthAccessToken && isLikelyOpenAIApiKey(apiKey)) {
			defaultSettings.env = {
				...((defaultSettings.env as Record<string, string> | undefined) ?? {}),
				OPENAI_API_KEY: apiKey,
			};
		}

		return {
			defaultSettings:
				Object.keys(defaultSettings).length > 0 ? defaultSettings : undefined,
		};
	}

	protected getProviderModelSettings(): Record<string, unknown> | undefined {
		return this.config.codex?.modelSettings;
	}

	protected getStreamErrorMessage(): string {
		return "Codex stream failed";
	}

	protected getEmitStreamOptions(): Omit<
		EmitAiSdkStreamOptions,
		"responseId" | "errorMessage" | "calculateCost"
	> {
		return {
			reasoningTypes: ["reasoning-delta", "reasoning"],
			toolCallArgsOrder: ["args", "input"],
		};
	}
}

export class ClaudeCodeHandler extends AiSdkProviderHandler {
	protected getProviderDefinition() {
		return {
			moduleName: "ai-sdk-provider-claude-code",
			createExportName: "createClaudeCode",
			providerExportName: "claudeCode",
			missingDependencyError:
				"Claude Code provider requires `ai-sdk-provider-claude-code` at runtime. Install dependencies and run `claude login`.",
		};
	}

	protected getDefaultModelId(): string {
		return "sonnet";
	}

	protected getProviderCreateOptions(): Record<string, unknown> | undefined {
		return this.config.claudeCode ?? {};
	}

	protected getLoadAiSdkOptions() {
		return {
			beforeImport: () => {
				if (shouldDisableAiSdkWarnings()) {
					(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false;
				}
			},
		};
	}

	protected getStreamErrorMessage(): string {
		return "Claude Code stream failed";
	}

	protected getEmitStreamOptions(): Omit<
		EmitAiSdkStreamOptions,
		"responseId" | "errorMessage" | "calculateCost"
	> {
		return {
			reasoningTypes: ["reasoning-delta"],
		};
	}
}

export class OpenCodeHandler extends AiSdkProviderHandler {
	protected getProviderDefinition() {
		return {
			moduleName: "ai-sdk-provider-opencode-sdk",
			createExportName: "createOpencode",
			providerExportName: "opencode",
			missingDependencyError:
				"OpenCode provider requires `ai-sdk-provider-opencode-sdk` and OpenCode at runtime.",
		};
	}

	protected getDefaultModelId(): string {
		return "openai/gpt-5.3-codex";
	}

	protected getProviderCreateOptions(): Record<string, unknown> {
		const opencodeOptions = this.config.opencode ?? {};
		const defaultSettings = {
			...(opencodeOptions.defaultSettings ?? {}),
		};
		if ((defaultSettings as Record<string, unknown>).agent === undefined) {
			(defaultSettings as Record<string, unknown>).agent = "general";
		}
		return {
			hostname: opencodeOptions.hostname,
			port: opencodeOptions.port,
			autoStartServer: opencodeOptions.autoStartServer,
			serverTimeout: opencodeOptions.serverTimeout,
			defaultSettings:
				Object.keys(defaultSettings).length > 0 ? defaultSettings : undefined,
		};
	}

	protected getProviderModelSettings(): Record<string, unknown> | undefined {
		return this.config.opencode?.modelSettings;
	}

	protected normalizeModelId(modelId: string): string {
		return resolveOpenCodeModelId(modelId);
	}

	protected getStreamErrorMessage(): string {
		return "OpenCode stream failed";
	}

	protected getEmitStreamOptions(): Omit<
		EmitAiSdkStreamOptions,
		"responseId" | "errorMessage" | "calculateCost"
	> {
		return {
			reasoningTypes: ["reasoning-delta", "reasoning"],
			enableTextFallback: true,
		};
	}
}

export class SapAiCoreHandler extends AiSdkProviderHandler {
	protected getProviderDefinition() {
		return {
			moduleName: "@jerome-benoit/sap-ai-provider",
			createExportName: "createSAPAIProvider",
			providerExportName: "sapai",
			missingDependencyError:
				"SAP AI Core provider requires `@jerome-benoit/sap-ai-provider` at runtime.",
		};
	}

	protected getDefaultModelId(): string {
		return "anthropic--claude-3.5-sonnet";
	}

	protected getProviderCreateOptions(): Record<string, unknown> | undefined {
		const sapOptions = this.config.sap ?? {};
		const api =
			sapOptions.api ??
			(sapOptions.useOrchestrationMode === undefined
				? undefined
				: sapOptions.useOrchestrationMode
					? "orchestration"
					: "foundation-models");

		const createOptions: Record<string, unknown> = {
			resourceGroup: sapOptions.resourceGroup,
			deploymentId: sapOptions.deploymentId,
			api,
			defaultSettings: sapOptions.defaultSettings,
		};

		const cleaned = Object.fromEntries(
			Object.entries(createOptions).filter(([, value]) => value !== undefined),
		);
		return Object.keys(cleaned).length > 0 ? cleaned : undefined;
	}

	protected getStreamErrorMessage(): string {
		return "SAP AI Core stream failed";
	}

	protected getEmitStreamOptions(): Omit<
		EmitAiSdkStreamOptions,
		"responseId" | "errorMessage" | "calculateCost"
	> {
		return {
			reasoningTypes: ["reasoning-delta", "reasoning"],
			enableToolCalls: true,
			toolCallArgsOrder: ["args", "input"],
		};
	}
}

export class MistralHandler extends AiSdkProviderHandler {
	protected getProviderDefinition() {
		return {
			moduleName: "@ai-sdk/mistral",
			createExportName: "createMistral",
			providerExportName: "mistral",
			missingDependencyError:
				"Mistral provider requires `@ai-sdk/mistral` at runtime.",
		};
	}

	protected getDefaultModelId(): string {
		return "mistral-medium-latest";
	}

	protected getStreamErrorMessage(): string {
		return "Mistral stream failed";
	}
}

export class DifyHandler extends AiSdkProviderHandler {
	protected getProviderDefinition() {
		return {
			moduleName: "dify-ai-provider",
			createExportName: "createDifyProvider",
			providerExportName: "difyProvider",
			missingDependencyError:
				"Dify provider requires `dify-ai-provider` at runtime.",
		};
	}

	protected getDefaultModelId(): string {
		return "default";
	}

	protected getProviderCreateOptions(): Record<string, unknown> | undefined {
		if (!this.config.baseUrl) {
			return undefined;
		}
		return {
			baseURL: this.config.baseUrl,
		};
	}

	protected getProviderModelSettings(): Record<string, unknown> | undefined {
		const modelSettings: Record<string, unknown> = {
			responseMode: "blocking",
		};
		if (this.config.apiKey) {
			modelSettings.apiKey = this.config.apiKey;
		}
		return modelSettings;
	}

	protected getStreamErrorMessage(): string {
		return "Dify stream failed";
	}
}
