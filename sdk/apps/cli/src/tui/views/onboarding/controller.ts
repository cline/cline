import {
	getLocalProviderModels,
	listLocalProviders,
	ProviderSettingsManager,
	resolveProviderConfig,
	saveLocalProviderSettings,
} from "@clinebot/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
	toModelEntry,
	toProviderEntry,
} from "./model";

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
	const [apiKeyValue, setApiKeyValue] = useState("");
	const [apiKeyError, setApiKeyError] = useState("");
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
				detail: p.isOAuth ? "(OAuth)" : undefined,
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

	const modelList = useSearchableList(modelItems);

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

	const loadModelsForProvider = useCallback((providerId: string) => {
		setModelsLoading(true);
		setModelEntries([]);
		getLocalProviderModels(providerId)
			.then(({ models }) => {
				setModelEntries(models.map(toModelEntry));
			})
			.catch(() => {})
			.finally(() => setModelsLoading(false));
	}, []);

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

	const startOAuthFlow = useCallback(
		(providerId: OnboardingOAuthProviderId) => {
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
		[providerSettingsManager, resetAuth, transitionToModelPicker],
	);

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

	const selectProvider = useCallback(
		(providerId: string) => {
			const provider = providers.find((p) => p.id === providerId);
			if (!provider) return;
			if (provider.isOAuth) {
				if (isOnboardingOAuthProviderId(provider.id)) {
					startOAuthFlow(provider.id);
				}
			} else {
				setActiveProviderId(provider.id);
				setActiveProviderName(provider.name);
				setStep("byo_apikey");
				setApiKeyValue("");
				setApiKeyError("");
			}
		},
		[providers, startOAuthFlow],
	);

	const saveByoApiKey = useCallback(() => {
		const trimmed = apiKeyValue.trim();
		if (!trimmed) {
			setApiKeyError("API key cannot be empty");
			return;
		}
		saveLocalProviderSettings(providerSettingsManager, {
			providerId: activeProviderId,
			apiKey: trimmed,
		});
		transitionToModelPicker(activeProviderId);
	}, [
		apiKeyValue,
		activeProviderId,
		providerSettingsManager,
		transitionToModelPicker,
	]);

	const saveModelSelection = useCallback(() => {
		const item = modelList.selectedItem;
		if (!item) return;
		const existing =
			providerSettingsManager.getProviderSettings(activeProviderId);
		providerSettingsManager.saveProviderSettings(
			{ ...(existing ?? { provider: activeProviderId }), model: item.key },
			{ setLastUsed: true },
		);
		setSelectedModelId(item.key);
		const entry = modelEntries.find((m) => m.id === item.key);
		if (entry?.supportsReasoning) {
			setSelectedModelName(entry.name);
			setThinkingSelected(0);
			setStep("thinking_level");
		} else {
			setStep("done");
		}
	}, [
		modelList.selectedItem,
		activeProviderId,
		modelEntries,
		providerSettingsManager,
	]);

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
		setApiKeyValue,
		setApiKeyError,
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
		startOAuthFlow,
		startDeviceCodeFlow,
		selectProvider,
		loadModelsForProvider,
		saveClineModelSelection,
		saveModelSelection,
		saveThinkingLevel,
	});

	return {
		activeProviderName,
		apiKeyError,
		apiKeyValue,
		authError,
		authStatus,
		authUrl,
		clineEntries,
		clineKnownModels,
		clineModelSelected,
		deviceError,
		deviceStatus,
		deviceUserCode,
		deviceVerifyUrl,
		handleApiKeyInput: (value: string) => {
			setApiKeyValue(value);
			setApiKeyError("");
		},
		menuSelected,
		modelItems,
		modelList,
		modelsLoading,
		oauthProvider,
		providerList,
		providersLoading,
		recommendedLoading: recommended.loading,
		saveByoApiKey,
		selectedModelName,
		step,
		thinkingSelected,
	};
}
