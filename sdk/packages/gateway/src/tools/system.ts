import type { BotRecord, EngineInvocation } from "@cline/bot";
import type { EffectiveToolPreview } from "@cline/shared/gateway";
import type { RunAttemptStore } from "../stores";
import { ToolCatalog } from "./catalog";
import { previewTools, resolveToolSnapshot } from "./resolver";
import type { ToolConfigurationStore } from "./store";

export interface GatewayToolSystemOptions {
	catalog?: ToolCatalog;
	configurations: ToolConfigurationStore;
	attempts: RunAttemptStore;
	getBot(botId: string): BotRecord | undefined;
	resolveModelSelection(invocation: EngineInvocation): {
		providerId: string;
		modelId: string;
		capabilities?: readonly string[];
		manifestRevision?: string;
		strictToolCalling?: boolean;
	};
	clock?: () => number;
}

export class GatewayToolSystem {
	readonly catalog: ToolCatalog;
	readonly configurations: ToolConfigurationStore;
	private readonly attempts: RunAttemptStore;
	private readonly getBot: GatewayToolSystemOptions["getBot"];
	private readonly resolveModelSelection: GatewayToolSystemOptions["resolveModelSelection"];
	private readonly clock: () => number;

	constructor(options: GatewayToolSystemOptions) {
		this.catalog = options.catalog ?? new ToolCatalog();
		this.configurations = options.configurations;
		this.attempts = options.attempts;
		this.getBot = options.getBot;
		this.resolveModelSelection = options.resolveModelSelection;
		this.clock = options.clock ?? (() => Date.now());
		this.configurations.bootstrap(this.clock());
	}

	preview(invocation: EngineInvocation): EffectiveToolPreview {
		const context = this.resolutionContext(invocation);
		return previewTools(this.catalog.current, context);
	}

	previewFor(input: {
		botId: string;
		workspaceRoot: string;
		providerId: string;
		modelId: string;
		turn?: NonNullable<EngineInvocation["overrides"]>["tools"];
	}): EffectiveToolPreview {
		const bot = this.getBot(input.botId);
		if (!bot) throw new Error(`Bot ${input.botId} does not exist`);
		return previewTools(this.catalog.current, {
			providerId: input.providerId,
			modelId: input.modelId,
			role: bot.identity.role,
			global: this.configurations.get({ kind: "global" })?.config,
			workspace: this.configurations.get({
				kind: "workspace",
				workspaceRoot: input.workspaceRoot,
			})?.config,
			bot:
				bot.config.tools ??
				this.configurations.get({ kind: "bot", botId: input.botId })?.config,
			turn: input.turn,
			profiles: this.configurations.listProfiles(),
		});
	}

	prepareAttempt(
		invocation: EngineInvocation,
		attempt: number,
	): EngineInvocation {
		const priorSnapshot = [...this.attempts.listByRun(invocation.runId)]
			.reverse()
			.find(
				(record) => record.attempt < attempt && record.executionSnapshot,
			)?.executionSnapshot;
		const snapshot =
			priorSnapshot ??
			resolveToolSnapshot(
				this.catalog.current,
				this.resolutionContext(invocation),
			);
		this.attempts.setExecutionSnapshot(invocation.runId, attempt, snapshot);
		const resolvedPolicies = Object.fromEntries(
			snapshot.tools.map((tool) => [
				tool.modelFacingName,
				{ autoApprove: tool.approval.mode === "never" },
			]),
		);
		return Object.freeze({
			...invocation,
			executionSnapshot: snapshot,
			effectiveConfig: Object.freeze({
				...invocation.effectiveConfig,
				toolPolicies: {
					...resolvedPolicies,
					...invocation.effectiveConfig.toolPolicies,
				},
			}),
		});
	}

	private resolutionContext(invocation: EngineInvocation) {
		const bot = this.getBot(invocation.botId);
		if (!bot) throw new Error(`Bot ${invocation.botId} does not exist`);
		const model = this.resolveModelSelection(invocation);
		return {
			providerId: model.providerId,
			modelId: model.modelId,
			source: invocation.source,
			modelCapabilities: model.capabilities,
			modelManifestRevision: model.manifestRevision,
			strictToolCalling: model.strictToolCalling,
			role: bot.identity.role,
			global: this.configurations.get({ kind: "global" })?.config,
			workspace: this.configurations.get({
				kind: "workspace",
				workspaceRoot: invocation.workspaceRoot,
			})?.config,
			bot:
				invocation.effectiveConfig.tools ??
				this.configurations.get({ kind: "bot", botId: invocation.botId })
					?.config,
			turn: invocation.overrides?.tools,
			profiles: this.configurations.listProfiles(),
			now: this.clock(),
		};
	}
}
