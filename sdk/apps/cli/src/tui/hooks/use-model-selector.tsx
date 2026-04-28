import {
	fetchClineRecommendedModels,
	Llms,
	ProviderSettingsManager,
	resolveProviderConfig,
} from "@clinebot/core";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import { useCallback } from "react";
import {
	getPersistedProviderApiKey,
	isOAuthProvider,
} from "../../utils/provider-auth";
import type { Config } from "../../utils/types";
import {
	ApiKeyInputContent,
	type ExistingProviderAction,
	OAuthLoginContent,
	ProviderPickerContent,
	UseExistingOrReconfigureContent,
} from "../components/dialogs/provider-picker";
import { buildClineModelEntries } from "../components/model-selector/cline-model-picker";
import {
	BROWSE_ALL_ACTION,
	ClineModelSelectorDialogContent,
} from "../components/model-selector/cline-model-selector";
import {
	buildModelOptions,
	CHANGE_PROVIDER_ACTION,
	type ModelOption,
	ModelSelectorContent,
	type ThinkingLevel,
	ThinkingLevelContent,
} from "../components/model-selector/model-selector";

export interface OpenModelSelectorOptions {
	onCancel?: () => Promise<void> | void;
	startWithProviderChange?: boolean;
}

async function getProviderDisplayName(providerId: string): Promise<string> {
	const info = await Llms.getProvider(providerId);
	return info?.name ?? providerId;
}

function clearReasoningConfig(config: Config): void {
	config.thinking = false;
	config.reasoningEffort = undefined;
}

async function runProviderChange(
	dialog: DialogActions,
	config: Config,
	termHeight: number,
	onModelChange: () => Promise<void>,
): Promise<boolean> {
	const newProviderId = await dialog.choice<string>({
		style: { maxHeight: termHeight - 2 },
		content: (ctx: ChoiceContext<string>) => (
			<ProviderPickerContent {...ctx} currentProviderId={config.providerId} />
		),
	});
	if (!newProviderId) return false;

	const displayName = await getProviderDisplayName(newProviderId);
	const manager = new ProviderSettingsManager();
	const existingSettings = manager.getProviderSettings(newProviderId);
	const existingKey = getPersistedProviderApiKey(
		newProviderId,
		existingSettings,
	);

	let needsAuth = true;
	if (existingKey) {
		const action = await dialog.choice<ExistingProviderAction>({
			style: { maxHeight: termHeight - 2 },
			content: (ctx: ChoiceContext<ExistingProviderAction>) => (
				<UseExistingOrReconfigureContent {...ctx} providerName={displayName} />
			),
		});
		if (!action) return false;
		needsAuth = action === "reconfigure";
	}

	if (needsAuth) {
		let saved: boolean | undefined;
		if (isOAuthProvider(newProviderId)) {
			saved = await dialog.choice<boolean>({
				style: { maxHeight: termHeight - 2 },
				closeOnEscape: false,
				content: (ctx: ChoiceContext<boolean>) => (
					<OAuthLoginContent
						{...ctx}
						providerId={newProviderId}
						providerName={displayName}
					/>
				),
			});
		} else {
			saved = await dialog.choice<boolean>({
				style: { maxHeight: termHeight - 2 },
				closeOnEscape: false,
				content: (ctx: ChoiceContext<boolean>) => (
					<ApiKeyInputContent
						{...ctx}
						providerId={newProviderId}
						providerName={displayName}
					/>
				),
			});
		}
		if (!saved) return false;
	}
	const newSettings = manager.getProviderSettings(newProviderId);
	const newApiKey =
		getPersistedProviderApiKey(newProviderId, newSettings) ?? "";

	manager.saveProviderSettings(
		{
			...(newSettings ?? {}),
			provider: newProviderId,
		},
		{ setLastUsed: true },
	);

	config.providerId = newProviderId;
	config.apiKey = newApiKey;

	const resolved = await resolveProviderConfig(newProviderId, {
		loadLatestOnInit: true,
		loadPrivateOnAuth: true,
		failOnError: false,
	});
	config.knownModels = resolved?.knownModels;
	const modelIds = Object.keys(resolved?.knownModels ?? {});
	if (newSettings?.model) {
		config.modelId = newSettings.model;
	} else if (modelIds[0]) {
		config.modelId = modelIds[0];
	}

	await onModelChange();
	return true;
}

export function useModelSelector(opts: {
	dialog: DialogActions;
	config: Config;
	termHeight: number;
	onModelChange: () => Promise<void>;
	refocusTextarea: () => void;
}) {
	const { dialog, config, termHeight, onModelChange, refocusTextarea } = opts;

	const openModelSelector = useCallback(
		async (options?: OpenModelSelectorOptions) => {
			const handleCancel = async () => {
				if (options?.onCancel) {
					await options.onCancel();
					return;
				}
				refocusTextarea();
			};

			let modelOptions = buildModelOptions(
				config.knownModels as Record<string, Llms.ModelInfo>,
			);
			let providerDisplayName = await getProviderDisplayName(config.providerId);

			if (options?.startWithProviderChange) {
				const changed = await runProviderChange(
					dialog,
					config,
					termHeight,
					onModelChange,
				);
				if (!changed) {
					await handleCancel();
					return;
				}
				modelOptions = buildModelOptions(
					config.knownModels as Record<string, Llms.ModelInfo>,
				);
				providerDisplayName = await getProviderDisplayName(config.providerId);
			}

			let pickingModel = true;

			while (config.providerId === "cline" && pickingModel) {
				const clineResult = await dialog.choice<string>({
					style: { maxHeight: termHeight - 2 },
					content: (ctx: ChoiceContext<string>) => (
						<ClineModelSelectorDialogContent
							{...ctx}
							currentModel={config.modelId}
							currentProviderName={providerDisplayName}
							knownModels={config.knownModels as Record<string, unknown>}
							loadEntries={async () =>
								buildClineModelEntries(await fetchClineRecommendedModels())
							}
						/>
					),
				});
				if (!clineResult) {
					await handleCancel();
					return;
				}
				if (clineResult === CHANGE_PROVIDER_ACTION) {
					await runProviderChange(dialog, config, termHeight, onModelChange);
					providerDisplayName = await getProviderDisplayName(config.providerId);
					modelOptions = buildModelOptions(
						config.knownModels as Record<string, Llms.ModelInfo>,
					);
					continue;
				}
				if (clineResult === BROWSE_ALL_ACTION) {
					const browseResult = await dialog.choice<string>({
						style: { maxHeight: termHeight - 2 },
						content: (ctx: ChoiceContext<string>) => (
							<ModelSelectorContent
								{...ctx}
								currentModel={config.modelId}
								currentProviderName={providerDisplayName}
								models={modelOptions}
							/>
						),
					});
					if (!browseResult) continue;
					if (browseResult === CHANGE_PROVIDER_ACTION) {
						await runProviderChange(dialog, config, termHeight, onModelChange);
						providerDisplayName = await getProviderDisplayName(
							config.providerId,
						);
						modelOptions = buildModelOptions(
							config.knownModels as Record<string, Llms.ModelInfo>,
						);
						continue;
					}
					config.modelId = browseResult;
					const browseModel = modelOptions.find(
						(m: ModelOption) => m.key === browseResult,
					);
					if (browseModel?.supportsReasoning) {
						const lvl: ThinkingLevel = config.reasoningEffort
							? (config.reasoningEffort as ThinkingLevel)
							: config.thinking
								? "medium"
								: "none";
						const pick = await dialog.choice<ThinkingLevel>({
							style: { maxHeight: termHeight - 2 },
							content: (ctx: ChoiceContext<ThinkingLevel>) => (
								<ThinkingLevelContent
									{...ctx}
									modelName={browseModel.name}
									currentLevel={lvl}
								/>
							),
						});
						if (pick !== undefined) {
							if (pick === "none") {
								config.thinking = false;
								config.reasoningEffort = undefined;
							} else {
								config.thinking = true;
								config.reasoningEffort = pick;
							}
						}
					}
					if (!browseModel?.supportsReasoning) {
						clearReasoningConfig(config);
					}
					pickingModel = false;
				} else {
					config.modelId = clineResult;
					const selectedModel = modelOptions.find(
						(m: ModelOption) => m.key === clineResult,
					);
					if (selectedModel?.supportsReasoning) {
						const currentLevel: ThinkingLevel = config.reasoningEffort
							? (config.reasoningEffort as ThinkingLevel)
							: config.thinking
								? "medium"
								: "none";
						const thinkingLevel = await dialog.choice<ThinkingLevel>({
							style: { maxHeight: termHeight - 2 },
							content: (ctx: ChoiceContext<ThinkingLevel>) => (
								<ThinkingLevelContent
									{...ctx}
									modelName={selectedModel.name}
									currentLevel={currentLevel}
								/>
							),
						});
						if (thinkingLevel !== undefined) {
							if (thinkingLevel === "none") {
								config.thinking = false;
								config.reasoningEffort = undefined;
							} else {
								config.thinking = true;
								config.reasoningEffort = thinkingLevel;
							}
						}
					}
					if (!selectedModel?.supportsReasoning) {
						clearReasoningConfig(config);
					}
					pickingModel = false;
				}
			}

			while (pickingModel) {
				const selectedKey = await dialog.choice<string>({
					style: { maxHeight: termHeight - 2 },
					content: (ctx: ChoiceContext<string>) => (
						<ModelSelectorContent
							{...ctx}
							currentModel={config.modelId}
							currentProviderName={providerDisplayName}
							models={modelOptions}
						/>
					),
				});
				if (!selectedKey) {
					await handleCancel();
					return;
				}

				if (selectedKey === CHANGE_PROVIDER_ACTION) {
					const changed = await runProviderChange(
						dialog,
						config,
						termHeight,
						onModelChange,
					);
					if (changed) {
						providerDisplayName = await getProviderDisplayName(
							config.providerId,
						);
						modelOptions = buildModelOptions(
							config.knownModels as Record<string, Llms.ModelInfo>,
						);
					}
					continue;
				}

				config.modelId = selectedKey;

				const selectedModel = modelOptions.find(
					(m: ModelOption) => m.key === selectedKey,
				);
				if (!selectedModel?.supportsReasoning) {
					clearReasoningConfig(config);
					pickingModel = false;
					break;
				}

				const currentLevel: ThinkingLevel = config.reasoningEffort
					? (config.reasoningEffort as ThinkingLevel)
					: config.thinking
						? "medium"
						: "none";

				const thinkingLevel = await dialog.choice<ThinkingLevel>({
					style: { maxHeight: termHeight - 2 },
					content: (ctx: ChoiceContext<ThinkingLevel>) => (
						<ThinkingLevelContent
							{...ctx}
							modelName={selectedModel.name}
							currentLevel={currentLevel}
						/>
					),
				});

				if (thinkingLevel === undefined) {
					continue;
				}

				if (thinkingLevel === "none") {
					config.thinking = false;
					config.reasoningEffort = undefined;
				} else {
					config.thinking = true;
					config.reasoningEffort = thinkingLevel;
				}
				pickingModel = false;
			}

			await onModelChange();
			refocusTextarea();
		},
		[dialog, config, termHeight, onModelChange, refocusTextarea],
	);

	return openModelSelector;
}
