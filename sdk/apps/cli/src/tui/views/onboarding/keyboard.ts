import { useKeyboard } from "@opentui/react";
import type { Dispatch, SetStateAction } from "react";
import type { ClineModelPickerEntry } from "../../components/model-selector/cline-model-picker";
import type { SearchableListState } from "../../components/searchable-list";
import type { OnboardingOAuthProviderId } from "./auth";
import {
	MAIN_MENU,
	type OnboardingStep,
	THINKING_LEVELS,
	type ThinkingLevel,
} from "./model";

export function useOnboardingKeyboard(input: {
	step: OnboardingStep;
	onExit: () => void;
	oauthProvider: string;
	activeProviderId: string;
	menuSelected: number;
	providerList: SearchableListState;
	modelList: SearchableListState;
	clineEntries: ClineModelPickerEntry[];
	clineModelSelected: number;
	thinkingSelected: number;
	setStep: (step: OnboardingStep) => void;
	setMenuSelected: Dispatch<SetStateAction<number>>;
	resetByoFields: () => void;
	byoFields: { apiKey?: unknown; baseUrl?: unknown };
	byoFocusedField: "apiKey" | "baseUrl";
	setByoFocusedField: (field: "apiKey" | "baseUrl") => void;
	setDeviceUserCode: (value: string) => void;
	setDeviceVerifyUrl: (value: string) => void;
	setDeviceError: (value: string) => void;
	setDeviceStatus: (value: string) => void;
	setClineModelSelected: Dispatch<SetStateAction<number>>;
	setThinkingSelected: Dispatch<SetStateAction<number>>;
	abortOAuth: () => void;
	abortDeviceCode: () => void;
	resetAuth: () => void;
	startOAuthFlow: (providerId: OnboardingOAuthProviderId) => void;
	startDeviceCodeFlow: (providerId: OnboardingOAuthProviderId) => void;
	selectProvider: (providerId: string) => void;
	loadModelsForProvider: (providerId: string) => void;
	saveClineModelSelection: (modelId: string, modelName: string) => void;
	saveModelSelection: () => void;
	saveThinkingLevel: (level: ThinkingLevel) => void;
}) {
	useKeyboard((key) => {
		if (input.step === "done") return;

		if (key.ctrl && key.name === "c") {
			input.onExit();
			return;
		}

		if (key.name === "escape") {
			if (input.step === "oauth_pending") {
				input.abortOAuth();
				input.resetAuth();
				input.setStep("menu");
				input.setMenuSelected(0);
				return;
			}
			if (input.step === "device_code") {
				input.abortDeviceCode();
				input.setDeviceUserCode("");
				input.setDeviceVerifyUrl("");
				input.setDeviceError("");
				input.setDeviceStatus("");
				input.setStep("menu");
				input.setMenuSelected(0);
				return;
			}
			if (input.step === "byo_apikey") {
				input.resetByoFields();
				input.setStep("byo_provider");
				return;
			}
			if (input.step === "byo_provider") {
				input.setStep("menu");
				input.setMenuSelected(0);
				return;
			}
			if (input.step === "cline_model") {
				input.setStep("menu");
				input.setMenuSelected(0);
				return;
			}
			if (input.step === "model_picker") {
				if (input.activeProviderId === "cline") {
					input.setClineModelSelected(0);
					input.setStep("cline_model");
				} else {
					input.setStep("menu");
					input.setMenuSelected(0);
				}
				return;
			}
			if (input.step === "custom_model_id") {
				input.setStep("model_picker");
				return;
			}
			if (input.step === "thinking_level") {
				if (input.activeProviderId === "cline") {
					input.setClineModelSelected(0);
					input.setStep("cline_model");
				} else {
					input.setStep("model_picker");
					input.loadModelsForProvider(input.activeProviderId);
				}
			}
			return;
		}

		if (input.step === "oauth_pending") {
			if (key.name === "d" && input.oauthProvider === "cline") {
				input.abortOAuth();
				input.resetAuth();
				input.startDeviceCodeFlow("cline");
			}
			return;
		}

		if (input.step === "device_code") return;

		if (input.step === "menu") {
			if (key.name === "up") {
				input.setMenuSelected((s) => (s <= 0 ? MAIN_MENU.length - 1 : s - 1));
				return;
			}
			if (key.name === "down") {
				input.setMenuSelected((s) => (s >= MAIN_MENU.length - 1 ? 0 : s + 1));
				return;
			}
			if (key.name === "return") {
				const option = MAIN_MENU[input.menuSelected];
				if (!option) return;
				if (option.value === "cline" || option.value === "openai-codex") {
					input.startOAuthFlow(option.value);
				} else {
					input.setStep("byo_provider");
				}
			}
			return;
		}

		if (input.step === "byo_provider") {
			if (key.name === "up" || (key.ctrl && key.name === "p")) {
				input.providerList.moveUp();
				return;
			}
			if (key.name === "down" || (key.ctrl && key.name === "n")) {
				input.providerList.moveDown();
				return;
			}
			if (key.name === "return") {
				const item = input.providerList.selectedItem;
				if (item) input.selectProvider(item.key);
			}
			return;
		}

		if (input.step === "byo_apikey") {
			if (key.name === "tab") {
				const visible = (["baseUrl", "apiKey"] as const).filter(
					(k) => input.byoFields[k] !== undefined,
				);
				if (visible.length > 1) {
					const idx = visible.indexOf(input.byoFocusedField);
					const nextIdx = key.shift
						? (idx - 1 + visible.length) % visible.length
						: (idx + 1) % visible.length;
					const next = visible[nextIdx];
					if (next) input.setByoFocusedField(next);
				}
			}
			return;
		}

		if (input.step === "cline_model") {
			const total = input.clineEntries.length;
			if (total === 0) return;
			if (key.name === "up" || (key.ctrl && key.name === "p")) {
				input.setClineModelSelected((s) => (s <= 0 ? total - 1 : s - 1));
				return;
			}
			if (key.name === "down" || (key.ctrl && key.name === "n")) {
				input.setClineModelSelected((s) => (s >= total - 1 ? 0 : s + 1));
				return;
			}
			if (key.name === "return") {
				const entry = input.clineEntries[input.clineModelSelected];
				if (!entry) return;
				if (entry.kind === "model") {
					input.saveClineModelSelection(entry.model.id, entry.model.name);
				} else {
					input.setStep("model_picker");
					input.loadModelsForProvider(input.activeProviderId);
				}
			}
			return;
		}

		if (input.step === "model_picker") {
			if (key.name === "up" || (key.ctrl && key.name === "p")) {
				input.modelList.moveUp();
				return;
			}
			if (key.name === "down" || (key.ctrl && key.name === "n")) {
				input.modelList.moveDown();
				return;
			}
			if (key.name === "return") {
				input.saveModelSelection();
			}
			return;
		}

		if (input.step === "thinking_level") {
			if (key.name === "up" || (key.ctrl && key.name === "p")) {
				input.setThinkingSelected((s) =>
					s <= 0 ? THINKING_LEVELS.length - 1 : s - 1,
				);
				return;
			}
			if (key.name === "down" || (key.ctrl && key.name === "n")) {
				input.setThinkingSelected((s) =>
					s >= THINKING_LEVELS.length - 1 ? 0 : s + 1,
				);
				return;
			}
			if (key.name === "return") {
				const level = THINKING_LEVELS[input.thinkingSelected];
				if (level) input.saveThinkingLevel(level.value);
			}
		}
	});
}
