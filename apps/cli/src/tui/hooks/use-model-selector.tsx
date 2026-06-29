import {
	fetchClineRecommendedModels,
	getProviderConfigFields,
	Llms,
	ProviderSettingsManager,
	refreshProviderModelsFromSource,
	resolveProviderConfig,
} from "@cline/core";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import { useCallback } from "react";
import { isOpenAICodexCliProvider } from "../../utils/codex-cli";
import {
	getPersistedProviderApiKey,
	isOAuthProvider,
	isProviderConfigured,
} from "../../utils/provider-auth";
import type { Config } from "../../utils/types";
import { withLoadingDialog } from "../components/dialogs/loading-dialog";
import {
	ClinePassSubscriptionContent,
	ClineUsageBillingContent,
	CodexCliStatusContent,
	type ExistingProviderOption,
	OAuthLoginContent,
	ProviderConfigInputContent,
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
	ModelIdInputContent,
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

async function refreshCurrentProviderModels(config: Config): Promise<void> {
	const manager = new ProviderSettingsManager();
	await refreshProviderModelsFromSource(manager, config.providerId).catch(
		() => {},
	);
	const resolved = await resolveProviderConfig(
		config.providerId,
		{
			loadLatestOnInit: true,
			loadPrivateOnAuth: true,
			failOnError: false,
		},
		manager.getProviderConfig(config.providerId, { includeKnownModels: false }),
	);
	if (resolved?.knownModels) {
		config.knownModels = resolved.knownModels;
	}
}

function clearReasoningConfig(config: Config): void {
	config.thinking = false;
	config.reasoningEffort = undefined;
}

function usesModelIdInput(providerId: string): boolean {
	return providerId === "openai-compatible";
}

function providerToExistingProviderOptions(input: {
	providerId: string;
	providerName: string;
	dialog: DialogActions;
	termHeight: number;
}): ExistingProviderOption[] {
	if (input.providerId !== "cline-pass") {
		return [];
	}

	return [
		{
			value: "open_subscription_page",
			label: "Open subscription page",
			onSelect: async () => {
				await input.dialog.choice<boolean>({
					style: { maxHeight: input.termHeight - 2 },
					closeOnEscape: false,
					content: (ctx: ChoiceContext<boolean>) => (
						<ClinePassSubscriptionContent
							{...ctx}
							providerName={input.providerName}
						/>
					),
				});
			},
		},
		{
			value: "open_usage_billing",
			label: "See usage and billing",
			onSelect: async () => {
				await input.dialog.choice<boolean>({
					style: { maxHeight: input.termHeight - 2 },
					closeOnEscape: false,
					content: (ctx: ChoiceContext<boolean>) => (
						<ClineUsageBillingContent
							{...ctx}
							providerName={input.providerName}
						/>
					),
				});
			},
		},
	];
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

	const manager = new ProviderSettingsManager();
	const displayName = await withLoadingDialog(
		dialog,
		"Loading provider...",
		async () => await getProviderDisplayName(newProviderId),
	);
	const existingSettings = manager.getProviderSettings(newProviderId);

	let needsAuth = true;
	if (isProviderConfigured(newProviderId, existingSettings)) {
		let option: ExistingProviderOption | undefined;
		const extraOptions = providerToExistingProviderOptions({
			providerId: newProviderId,
			providerName: displayName,
			dialog,
			termHeight,
		});
		while (true) {
			option = await dialog.choice<ExistingProviderOption>({
				style: { maxHeight: termHeight - 2 },
				content: (ctx: ChoiceContext<ExistingProviderOption>) => (
					<UseExistingOrReconfigureContent
						{...ctx}
						providerName={displayName}
						extraOptions={extraOptions}
					/>
				),
			});
			if (!option) return false;
			if (option.onSelect) {
				await option.onSelect();
				option = undefined;
				continue;
			}
			break;
		}
		needsAuth = option.value === "reconfigure";
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
		} else if (isOpenAICodexCliProvider(newProviderId)) {
			saved = await dialog.choice<boolean>({
				style: { maxHeight: termHeight - 2 },
				closeOnEscape: false,
				content: (ctx: ChoiceContext<boolean>) => (
					<CodexCliStatusContent {...ctx} providerName={displayName} />
				),
			});
			if (saved) {
				manager.saveProviderSettings({
					...(existingSettings ?? {}),
					provider: newProviderId,
				});
			}
		} else {
			const { fields } = getProviderConfigFields(newProviderId);
			saved = await dialog.choice<boolean>({
				style: { maxHeight: termHeight - 2 },
				closeOnEscape: false,
				content: (ctx: ChoiceContext<boolean>) => (
					<ProviderConfigInputContent
						{...ctx}
						providerId={newProviderId}
						providerName={displayName}
						fields={fields}
						providerSettingsManager={manager}
					/>
				),
			});
		}
		if (!saved) return false;
	}
	await withLoadingDialog(
		dialog,
		`Loading ${displayName} models...`,
		async () => {
			await refreshProviderModelsFromSource(manager, newProviderId).catch(
				() => {},
			);
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
			const resolved = await resolveProviderConfig(
				newProviderId,
				{
					loadLatestOnInit: true,
					loadPrivateOnAuth: true,
					failOnError: false,
				},
				manager.getProviderConfig(newProviderId, { includeKnownModels: false }),
			);
			config.knownModels = resolved?.knownModels;
			const modelIds = Object.keys(resolved?.knownModels ?? {});
			if (newSettings?.model) {
				config.modelId = newSettings.model;
			} else if (modelIds[0]) {
				config.modelId = modelIds[0];
			}

			await onModelChange();
		},
	);
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
			let providerDisplayName = config.providerId;

			const refreshProviderContext = async () => {
				modelOptions = buildModelOptions(
					config.knownModels as Record<string, Llms.ModelInfo>,
				);
				providerDisplayName = await getProviderDisplayName(config.providerId);
			};

			if (!options?.startWithProviderChange) {
				await withLoadingDialog(dialog, "Loading models...", async () => {
					await refreshCurrentProviderModels(config);
					await refreshProviderContext();
				});
			}

			const changeProvider = async (): Promise<boolean> => {
				const changed = await runProviderChange(
					dialog,
					config,
					termHeight,
					onModelChange,
				);
				if (changed) {
					await withLoadingDialog(dialog, "Loading models...", async () => {
						await refreshProviderContext();
					});
				}
				return changed;
			};

			if (options?.startWithProviderChange) {
				const changed = await changeProvider();
				if (!changed) {
					await handleCancel();
					return;
				}
			}

			let pickingModel = true;

			while (pickingModel) {
				if (usesModelIdInput(config.providerId)) {
					const modelId = await dialog.choice<string>({
						style: { maxHeight: termHeight - 2 },
						content: (ctx: ChoiceContext<string>) => (
							<ModelIdInputContent
								{...ctx}
								currentModel={config.modelId}
								currentProviderName={providerDisplayName}
							/>
						),
					});
					if (!modelId) {
						await handleCancel();
						return;
					}
					if (modelId === CHANGE_PROVIDER_ACTION) {
						await changeProvider();
						continue;
					}
					config.modelId = modelId;
					clearReasoningConfig(config);
					pickingModel = false;
					continue;
				}

				if (config.providerId === "cline") {
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
						await changeProvider();
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
									showCustomModelId={config.providerId !== "cline-pass"}
								/>
							),
						});
						if (!browseResult) continue;
						if (browseResult === CHANGE_PROVIDER_ACTION) {
							await changeProvider();
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
						continue;
					}

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
					continue;
				}

				const selectedKey = await dialog.choice<string>({
					style: { maxHeight: termHeight - 2 },
					content: (ctx: ChoiceContext<string>) => (
						<ModelSelectorContent
							{...ctx}
							currentModel={config.modelId}
							currentProviderName={providerDisplayName}
							models={modelOptions}
							showCustomModelId={config.providerId !== "cline-pass"}
						/>
					),
				});
				if (!selectedKey) {
					await handleCancel();
					return;
				}

				if (selectedKey === CHANGE_PROVIDER_ACTION) {
					await changeProvider();
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

			await withLoadingDialog(dialog, "Applying model...", async () => {
				await onModelChange();
			});
			refocusTextarea();
		},
		[dialog, config, termHeight, onModelChange, refocusTextarea],
	);

	return openModelSelector;
}
