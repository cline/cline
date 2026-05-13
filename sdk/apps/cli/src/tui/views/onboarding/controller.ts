import {
	getLocalProviderModels,
	getProviderConfigFields,
	listLocalProviders,
	type ProviderConfigFields,
	ProviderSettingsManager,
	refreshProviderModelsFromSource,
	resolveProviderConfig,
	saveLocalProviderSettings,
} from "@cline/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type CodexCliStatus,
	checkCodexCliInstalled,
	isOpenAICodexCliProvider,
} from "../../../utils/codex-cli";
import { getPersistedProviderApiKey } from "../../../utils/provider-auth";
import {
	buildClineModelEntries,
	type ClineModelPickerEntry,
	useClineRecommendedModels,
} from "../../components/model-selector/cline-model-picker";
import {
	type SearchableItem,
	useSearchableList,
} from "../../components/searchable-list";
import { palette } from "../../palette";
import { getProviderSection } from "../../utils/provider-sections";
import {
	isOnboardingOAuthProviderId,
	type OnboardingOAuthProviderId,
	runDeviceCodeAuthFlow,
	runOAuthAuthFlow,
} from "./auth";
import { useOnboardingKeyboard } from "./keyboard";
import {
	type ModelEntry,
	type OnboardingResult,
	type OnboardingStep,
	type ProviderEntry,
	type ReasoningEffort,
	type ThinkingLevel,
	toModelEntriesFromKnownModels,
	toModelEntry,
	toProviderEntry,
} from "./model";

type ByoFieldKey = "apiKey" | "baseUrl";

const CUSTOM_MODEL_ID_ACTION = "__custom_model_id__";

export interface OnboardingControllerProps {
	onComplete: (result: OnboardingResult) => void;
	onExit: () => void;
	providerSettingsManager?: ProviderSettingsManager;
}

export function useOnboardingController(props: OnboardingControllerProps) {
	const { onComplete } = props;
	const providerSettingsManager = useMemo(
		() => props.providerSettingsManager ?? new ProviderSettingsManager(),
		[props.providerSettingsManager],
	);
	const [step, setStep] = useState<OnboardingStep>("menu");
	const [menuSelected, setMenuSelected] = useState(0);
	const [oauthProvider, setOauthProvider] = useState("");
	const [authStatus, setAuthStatus] = useState("");
	const [authUrl, setAuthUrl] = useState("");
	const [authError, setAuthError] = useState("");
	const [activeProviderId, setActiveProviderId] = useState("");
	const [activeProviderName, setActiveProviderName] = useState("");
	const [byoFields, setByoFields] = useState<ProviderConfigFields["fields"]>(
		{},
	);
	const [byoApiKey, setByoApiKey] = useState("");
	const [byoBaseUrl, setByoBaseUrl] = useState("");
	const [byoFocusedField, setByoFocusedField] = useState<ByoFieldKey>("apiKey");
	const [codexCliStatus, setCodexCliStatus] = useState<
		CodexCliStatus | undefined
	>();
	const [codexCliChecking, setCodexCliChecking] = useState(false);
	const authAbortRef = useRef(false);

	// Device code flow
	const [deviceUserCode, setDeviceUserCode] = useState("");
	const [deviceVerifyUrl, setDeviceVerifyUrl] = useState("");
	const [deviceStatus, setDeviceStatus] = useState("");
	const [deviceError, setDeviceError] = useState("");
	const deviceAbortRef = useRef(false);

	// Provider catalog
	const [providers, setProviders] = useState<ProviderEntry[]>([]);
	const [providersLoading, setProvidersLoading] = useState(true);

	useEffect(() => {
		listLocalProviders(providerSettingsManager)
			.then(({ providers: list }) => {
				setProviders(list.map(toProviderEntry));
			})
			.catch(() => {})
			.finally(() => setProvidersLoading(false));
	}, [providerSettingsManager]);

	const providerItems: SearchableItem[] = useMemo(
		() =>
			providers.map((p) => ({
				key: p.id,
				label: p.name,
				section: getProviderSection(p),
				detail: p.isOAuth
					? "(OAuth)"
					: p.isLocalAuth
						? "(local CLI)"
						: undefined,
				searchText: `${p.name} ${p.id}`,
				rightLabel: p.hasAuth ? "\u25cf" : undefined,
				rightLabelColor: palette.success,
			})),
		[providers],
	);

	const providerList = useSearchableList(providerItems);

	// Model catalog for selected provider
	const [modelEntries, setModelEntries] = useState<ModelEntry[]>([]);
	const [modelsLoading, setModelsLoading] = useState(false);
	const [modelsDefaultId, setModelsDefaultId] = useState("");
	const [customModelId, setCustomModelId] = useState("");
	const [customModelError, setCustomModelError] = useState("");

	const modelItems: SearchableItem[] = useMemo(
		() =>
			modelEntries.map((m) => ({
				key: m.id,
				label: m.name,
				searchText: `${m.name} ${m.id}`,
				rightLabel: m.id === modelsDefaultId ? "(default)" : undefined,
				rightLabelColor: "gray",
			})),
		[modelEntries, modelsDefaultId],
	);

	const createCustomModelItem = useCallback(
		(_search: string, filteredItems: SearchableItem[]) => {
			if (filteredItems.some((item) => item.key === CUSTOM_MODEL_ID_ACTION)) {
				return undefined;
			}
			return {
				key: CUSTOM_MODEL_ID_ACTION,
				label: "Create custom model ID",
				detail: "manual entry",
				searchText: "create custom model id manual entry",
			} satisfies SearchableItem;
		},
		[],
	);

	const modelList = useSearchableList(modelItems, createCustomModelItem);

	// Cline featured model picker
	const recommended = useClineRecommendedModels();
	const clineEntries: ClineModelPickerEntry[] = useMemo(
		() => (recommended.data ? buildClineModelEntries(recommended.data) : []),
		[recommended.data],
	);
	const [clineModelSelected, setClineModelSelected] = useState(0);
	const [clineModelReasoningIds, setClineModelReasoningIds] = useState<
		Set<string>
	>(new Set());
	const [clineKnownModels, setClineKnownModels] = useState<
		Record<string, unknown> | undefined
	>(undefined);

	useEffect(() => {
		getLocalProviderModels("cline")
			.then(({ models }) => {
				const ids = new Set<string>();
				for (const m of models) {
					if (m.supportsReasoning) ids.add(m.id);
				}
				setClineModelReasoningIds(ids);
			})
			.catch(() => {});
		resolveProviderConfig("cline")
			.then((resolved) => {
				if (resolved?.knownModels) setClineKnownModels(resolved.knownModels);
			})
			.catch(() => {});
	}, []);

	// Thinking level
	const [thinkingSelected, setThinkingSelected] = useState(0);
	const [selectedModelName, setSelectedModelName] = useState("");
	const [selectedModelId, setSelectedModelId] = useState("");
	const [selectedThinking, setSelectedThinking] = useState(false);
	const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<
		ReasoningEffort | undefined
	>(undefined);

	const loadModelsForProvider = useCallback(
		(providerId: string) => {
			setModelsLoading(true);
			setModelEntries([]);
			refreshProviderModelsFromSource(providerSettingsManager, providerId)
				.catch(() => {})
				.then(async () => {
					const providerConfig = providerSettingsManager.getProviderConfig(
						providerId,
						{ includeKnownModels: false },
					);
					const resolved = await resolveProviderConfig(
						providerId,
						{
							loadLatestOnInit: true,
							loadPrivateOnAuth: true,
							failOnError: false,
						},
						providerConfig,
					);
					const resolvedModels = toModelEntriesFromKnownModels(
						resolved?.knownModels,
					);
					if (resolvedModels.length > 0) {
						setModelsDefaultId(resolved?.modelId ?? "");
						return resolvedModels;
					}
					const { models } = await getLocalProviderModels(
						providerId,
						providerConfig,
					);
					return models.map(toModelEntry);
				})
				.then((models) => {
					setModelEntries(models);
				})
				.catch(() => {})
				.finally(() => setModelsLoading(false));
		},
		[providerSettingsManager],
	);

	const transitionToModelPicker = useCallback(
		(providerId: string) => {
			setActiveProviderId(providerId);
			const provider = providers.find((p) => p.id === providerId);
			setActiveProviderName(provider?.name ?? providerId);
			setModelsDefaultId(provider?.defaultModelId ?? "");
			if (providerId === "cline") {
				setClineModelSelected(0);
				setStep("cline_model");
			} else {
				setStep("model_picker");
				loadModelsForProvider(providerId);
			}
		},
		[providers, loadModelsForProvider],
	);

	const resetAuth = useCallback(() => {
		setAuthStatus("");
		setAuthUrl("");
		setAuthError("");
		authAbortRef.current = false;
	}, []);

	const startDeviceCodeFlow = useCallback(
		(providerId: OnboardingOAuthProviderId) => {
			deviceAbortRef.current = false;
			setDeviceUserCode("");
			setDeviceVerifyUrl("");
			setDeviceError("");
			setDeviceStatus("Requesting device code...");
			setOauthProvider(providerId);
			setStep("device_code");

			runDeviceCodeAuthFlow({
				providerId,
				providerSettingsManager,
				isAborted: () => deviceAbortRef.current,
				setUserCode: setDeviceUserCode,
				setVerifyUrl: setDeviceVerifyUrl,
				setStatus: setDeviceStatus,
				setError: setDeviceError,
				onComplete: transitionToModelPicker,
			});
		},
		[providerSettingsManager, transitionToModelPicker],
	);

	const startOAuthFlow = useCallback(
		(providerId: OnboardingOAuthProviderId) => {
			if (providerId === "cline") {
				startDeviceCodeFlow(providerId);
				return;
			}

			resetAuth();
			setOauthProvider(providerId);
			setStep("oauth_pending");
			setAuthStatus("Opening browser...");

			runOAuthAuthFlow({
				providerId,
				providerSettingsManager,
				isAborted: () => authAbortRef.current,
				setStatus: setAuthStatus,
				setAuthUrl,
				setError: setAuthError,
				onComplete: transitionToModelPicker,
			});
		},
		[
			providerSettingsManager,
			resetAuth,
			transitionToModelPicker,
			startDeviceCodeFlow,
		],
	);

	const refreshCodexCliStatus = useCallback(() => {
		setCodexCliStatus(undefined);
		setCodexCliChecking(true);
		checkCodexCliInstalled()
			.then(setCodexCliStatus)
			.catch((error: unknown) => {
				setCodexCliStatus({
					installed: false,
					reason: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => setCodexCliChecking(false));
	}, []);

	const selectProvider = useCallback(
		(providerId: string) => {
			const provider = providers.find((p) => p.id === providerId);
			if (!provider) return;
			if (provider.isOAuth) {
				if (isOnboardingOAuthProviderId(provider.id)) {
					startOAuthFlow(provider.id);
				}
				return;
			}
			if (provider.isLocalAuth || isOpenAICodexCliProvider(provider.id)) {
				setActiveProviderId(provider.id);
				setActiveProviderName(provider.name);
				setCodexCliStatus(undefined);
				setStep("codex_cli_setup");
				refreshCodexCliStatus();
				return;
			}
			const config = getProviderConfigFields(provider.id);
			setActiveProviderId(provider.id);
			setActiveProviderName(provider.name);
			setByoFields(config.fields);
			setByoApiKey("");
			setByoBaseUrl(
				providerSettingsManager
					.getProviderSettings(provider.id)
					?.baseUrl?.trim() ??
					config.fields.baseUrl?.defaultValue ??
					"",
			);
			// Focus base URL first when present (local-server users land on
			// the actionable input). Cloud providers see only `apiKey`.
			setByoFocusedField(config.fields.baseUrl ? "baseUrl" : "apiKey");
			setStep("byo_apikey");
		},
		[providers, startOAuthFlow, refreshCodexCliStatus, providerSettingsManager],
	);

	const saveCodexCliConfig = useCallback(() => {
		if (!codexCliStatus?.installed) {
			return;
		}
		saveLocalProviderSettings(providerSettingsManager, {
			providerId: activeProviderId,
		});
		transitionToModelPicker(activeProviderId);
	}, [
		activeProviderId,
		codexCliStatus,
		providerSettingsManager,
		transitionToModelPicker,
	]);

	const saveByoConfig = useCallback(() => {
		// No required-field validation. If credentials are missing or wrong,
		// the provider's own auth response is the authoritative error and is
		// surfaced when the model picker / first turn runs.
		saveLocalProviderSettings(providerSettingsManager, {
			providerId: activeProviderId,
			apiKey: byoFields.apiKey ? byoApiKey.trim() : undefined,
			baseUrl: byoFields.baseUrl ? byoBaseUrl.trim() : undefined,
		});
		transitionToModelPicker(activeProviderId);
	}, [
		byoApiKey,
		byoBaseUrl,
		byoFields,
		activeProviderId,
		providerSettingsManager,
		transitionToModelPicker,
	]);

	const completeModelSelection = useCallback(
		(modelId: string) => {
			const existing =
				providerSettingsManager.getProviderSettings(activeProviderId);
			providerSettingsManager.saveProviderSettings(
				{ ...(existing ?? { provider: activeProviderId }), model: modelId },
				{ setLastUsed: true },
			);
			setSelectedModelId(modelId);
			const entry = modelEntries.find((m) => m.id === modelId);
			if (entry?.supportsReasoning) {
				setSelectedModelName(entry.name);
				setThinkingSelected(0);
				setStep("thinking_level");
			} else {
				setStep("done");
			}
		},
		[activeProviderId, modelEntries, providerSettingsManager],
	);

	const selectModelItem = useCallback(
		(item: SearchableItem | undefined) => {
			if (!item) return;
			if (item.key === CUSTOM_MODEL_ID_ACTION) {
				setCustomModelId("");
				setCustomModelError("");
				setStep("custom_model_id");
				return;
			}
			completeModelSelection(item.key);
		},
		[completeModelSelection],
	);

	const saveModelSelection = useCallback(() => {
		selectModelItem(modelList.selectedItem);
	}, [modelList.selectedItem, selectModelItem]);

	const saveCustomModelId = useCallback(() => {
		const modelId = customModelId.trim();
		if (!modelId) {
			setCustomModelError("Enter a model ID");
			return;
		}
		completeModelSelection(modelId);
	}, [customModelId, completeModelSelection]);

	const saveClineModelSelection = useCallback(
		(modelId: string, modelName: string) => {
			const existing =
				providerSettingsManager.getProviderSettings(activeProviderId);
			providerSettingsManager.saveProviderSettings(
				{
					...(existing ?? { provider: activeProviderId }),
					model: modelId,
				},
				{ setLastUsed: true },
			);
			setSelectedModelId(modelId);
			if (clineModelReasoningIds.has(modelId)) {
				setSelectedModelName(modelName);
				setThinkingSelected(0);
				setStep("thinking_level");
			} else {
				setStep("done");
			}
		},
		[activeProviderId, clineModelReasoningIds, providerSettingsManager],
	);

	const saveThinkingLevel = useCallback(
		(level: ThinkingLevel) => {
			const existing =
				providerSettingsManager.getProviderSettings(activeProviderId);
			if (level === "none") {
				providerSettingsManager.saveProviderSettings({
					...(existing ?? { provider: activeProviderId }),
					reasoning: { enabled: false },
				});
				setSelectedThinking(false);
				setSelectedReasoningEffort(undefined);
			} else {
				providerSettingsManager.saveProviderSettings({
					...(existing ?? { provider: activeProviderId }),
					reasoning: { enabled: true, effort: level },
				});
				setSelectedThinking(true);
				setSelectedReasoningEffort(level);
			}
			setStep("done");
		},
		[activeProviderId, providerSettingsManager],
	);

	useEffect(() => {
		if (step !== "done") return undefined;
		const timer = setTimeout(() => {
			const providerSettings =
				providerSettingsManager.getProviderSettings(activeProviderId);
			onComplete({
				providerId: activeProviderId,
				modelId: selectedModelId,
				apiKey: getPersistedProviderApiKey(activeProviderId, providerSettings),
				thinking: selectedThinking,
				reasoningEffort: selectedReasoningEffort,
			});
		}, 500);
		return () => clearTimeout(timer);
	}, [
		step,
		onComplete,
		activeProviderId,
		selectedModelId,
		selectedThinking,
		selectedReasoningEffort,
		providerSettingsManager,
	]);

	useOnboardingKeyboard({
		step,
		onExit: props.onExit,
		oauthProvider,
		activeProviderId,
		menuSelected,
		providerList,
		modelList,
		clineEntries,
		clineModelSelected,
		thinkingSelected,
		setStep,
		setMenuSelected,
		resetByoFields: () => {
			setByoFields({});
			setByoApiKey("");
			setByoBaseUrl("");
		},
		byoFields,
		byoFocusedField,
		setByoFocusedField,
		setDeviceUserCode,
		setDeviceVerifyUrl,
		setDeviceError,
		setDeviceStatus,
		setClineModelSelected,
		setThinkingSelected,
		abortOAuth: () => {
			authAbortRef.current = true;
		},
		abortDeviceCode: () => {
			deviceAbortRef.current = true;
		},
		resetAuth,
		refreshCodexCliStatus,
		startOAuthFlow,
		startDeviceCodeFlow,
		selectProvider,
		loadModelsForProvider,
		saveClineModelSelection,
		saveCodexCliConfig,
		saveModelSelection,
		saveThinkingLevel,
	});

	return {
		activeProviderName,
		authError,
		authStatus,
		authUrl,
		byoApiKey,
		byoBaseUrl,
		byoFields,
		byoFocusedField,
		codexCliChecking,
		codexCliStatus,
		clineEntries,
		clineKnownModels,
		clineModelSelected,
		deviceError,
		deviceStatus,
		deviceUserCode,
		deviceVerifyUrl,
		customModelError,
		customModelId,
		handleByoApiKeyInput: setByoApiKey,
		handleByoBaseUrlInput: setByoBaseUrl,
		handleCustomModelIdInput: (value: string) => {
			setCustomModelId(value);
			setCustomModelError("");
		},
		handleModelItemSelect: selectModelItem,
		menuSelected,
		modelItems,
		modelList,
		modelsLoading,
		oauthProvider,
		providerList,
		providersLoading,
		recommendedLoading: recommended.loading,
		saveByoConfig,
		saveCodexCliConfig,
		saveCustomModelId,
		selectedModelName,
		step,
		thinkingSelected,
	};
}
