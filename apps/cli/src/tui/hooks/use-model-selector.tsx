import {
	fetchClineRecommendedModels,
	getProviderConfigFields,
	Llms,
	ProviderSettingsManager,
	refreshProviderModelsFromSource,
	resolveProviderConfig,
} from "@cline/core";
import { isClineProvider } from "@cline/shared";
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
	CodexCliStatusContent,
	type ExistingProviderOption,
	OAuthApiKeyInputContent,
	OAuthLoginContent,
	type OAuthLoginResult,
	ProviderConfigInputContent,
	ProviderPickerContent,
	UseExistingOrReconfigureContent,
} from "../components/dialogs/provider-picker";
import { buildFeaturedModelEntries } from "../components/model-selector/cline-model-picker";
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

/**
 * Ask an OpenAI-compatible endpoint for its model list (`GET <baseUrl>/models`)
 * using the provider's stored API key and headers, mirroring the extension's
 * refreshOpenAiModels handler. Returns [] on any failure so callers fall back
 * to manual model-id entry.
 */
async function fetchOpenAiCompatibleModelIds(
	providerId: string,
): Promise<string[]> {
	try {
		const manager = new ProviderSettingsManager();
		const config = manager.getProviderConfig(providerId, { includeKnownModels: false });
		const baseUrl = config?.baseUrl?.trim().replace(/\/+$/, "");
		if (!baseUrl || !URL.canParse(baseUrl)) return [];

		const headers: Record<string, string> = { ...(config?.headers ?? {}) };
		const apiKey = config?.apiKey?.trim();
		if (
			apiKey &&
			!Object.keys(headers).some((h) => h.toLowerCase() === "authorization")
		) {
			headers.Authorization = `Bearer ${apiKey}`;
		}

		const response = await fetch(`${baseUrl}/models`, {
			headers,
			signal: AbortSignal.timeout(5_000),
		});
		if (!response.ok) return [];
		const payload = (await response.json()) as { data?: unknown };
		const list = Array.isArray(payload?.data) ? payload.data : [];
		const ids = list
			.map((model) => {
				const id = (model as { id?: unknown } | null)?.id;
				return typeof id === "string" ? id.trim() : "";
			})
			.filter(Boolean);
		return [...new Set(ids)];
	} catch {
		return [];
	}
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
			label: "Manage subscription & see usage",
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

	// Manual API key entry is the escape hatch for when OAuth login isn't
	// working; only the Cline providers accept a dashboard API key.
	const supportsManualApiKey = isClineProvider(newProviderId);
	const openManualApiKeyDialog = async (): Promise<boolean | undefined> =>
		await dialog.choice<boolean>({
			style: { maxHeight: termHeight - 2 },
			closeOnEscape: false,
			content: (ctx: ChoiceContext<boolean>) => (
				<OAuthApiKeyInputContent
					{...ctx}
					providerId={newProviderId}
					providerName={displayName}
					providerSettingsManager={manager}
				/>
			),
		});

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
			const loginResult = await dialog.choice<OAuthLoginResult>({
				style: { maxHeight: termHeight - 2 },
				closeOnEscape: false,
				content: (ctx: ChoiceContext<OAuthLoginResult>) => (
					<OAuthLoginContent
						{...ctx}
						providerId={newProviderId}
						providerName={displayName}
						allowApiKeyFallback={supportsManualApiKey}
					/>
				),
			});
			saved =
				loginResult === "use_api_key"
					? await openManualApiKeyDialog()
					: loginResult;
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
			let endpointModelOptions: ModelOption[] = [];

			const refreshProviderContext = async () => {
				modelOptions = buildModelOptions(
					config.knownModels as Record<string, Llms.ModelInfo>,
				);
				providerDisplayName = await getProviderDisplayName(config.providerId);
				// Free-text providers (openai-compatible) can still suggest model
				// ids when their endpoint answers /models; otherwise they keep the
				// manual input.
				endpointModelOptions = usesModelIdInput(config.providerId)
					? buildModelOptions(
							Object.fromEntries(
								(await fetchOpenAiCompatibleModelIds(config.providerId)).map(
									(id) => [id, { id, name: id }],
								),
							),
						)
					: [];
				if (endpointModelOptions.length > 0) {
					modelOptions = endpointModelOptions;
				}
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
				if (
					usesModelIdInput(config.providerId) &&
					endpointModelOptions.length === 0
				) {
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

				if (
					config.providerId === "cline" ||
					config.providerId === "cline-pass"
				) {
					// ClinePass gets the same sectioned picker with Subscribed/Free
					// sections — free models are selectable while staying on ClinePass
					const featuredProviderId = config.providerId;
					const clineResult = await dialog.choice<string>({
						style: { maxHeight: termHeight - 2 },
						content: (ctx: ChoiceContext<string>) => (
							<ClineModelSelectorDialogContent
								{...ctx}
								currentModel={config.modelId}
								currentProviderName={providerDisplayName}
								knownModels={config.knownModels as Record<string, unknown>}
								loadEntries={async () =>
									buildFeaturedModelEntries(
										featuredProviderId,
										await fetchClineRecommendedModels(),
									)
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
