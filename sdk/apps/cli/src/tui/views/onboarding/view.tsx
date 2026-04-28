import type { ProviderSettingsManager } from "@clinebot/core";
import { useTerminalDimensions } from "@opentui/react";
import { useMouseTracker } from "../../components/tracked-robot";
import { HOME_VIEW_MAX_WIDTH } from "../../types";
import { useOnboardingController } from "./controller";
import { getOAuthProviderLabel, type OnboardingResult } from "./model";
import {
	OnboardingApiKeyScreen,
	OnboardingClineModelScreen,
	OnboardingDeviceCodeScreen,
	OnboardingDoneScreen,
	OnboardingMainMenuScreen,
	OnboardingModelPickerScreen,
	OnboardingOAuthPendingScreen,
	OnboardingProviderPickerScreen,
	OnboardingThinkingLevelScreen,
} from "./screens";

export interface OnboardingViewProps {
	onComplete: (result: OnboardingResult) => void;
	onExit: () => void;
	providerSettingsManager?: ProviderSettingsManager;
}

export function OnboardingView(props: OnboardingViewProps) {
	const { width, height } = useTerminalDimensions();
	const mouse = useMouseTracker();
	const state = useOnboardingController(props);
	const contentWidth = Math.min(width - 4, HOME_VIEW_MAX_WIDTH);
	const compact = height < 28;

	if (state.step === "done") {
		return <OnboardingDoneScreen mouse={mouse} />;
	}

	if (state.step === "oauth_pending") {
		return (
			<OnboardingOAuthPendingScreen
				authError={state.authError}
				authStatus={state.authStatus}
				authUrl={state.authUrl}
				compact={compact}
				contentWidth={contentWidth}
				label={getOAuthProviderLabel(state.oauthProvider)}
				mouse={mouse}
				oauthProvider={state.oauthProvider}
			/>
		);
	}

	if (state.step === "device_code") {
		return (
			<OnboardingDeviceCodeScreen
				compact={compact}
				contentWidth={contentWidth}
				deviceError={state.deviceError}
				deviceStatus={state.deviceStatus}
				deviceUserCode={state.deviceUserCode}
				deviceVerifyUrl={state.deviceVerifyUrl}
				label={getOAuthProviderLabel(state.oauthProvider)}
				mouse={mouse}
			/>
		);
	}

	if (state.step === "byo_apikey") {
		return (
			<OnboardingApiKeyScreen
				activeProviderName={state.activeProviderName}
				apiKeyError={state.apiKeyError}
				apiKeyValue={state.apiKeyValue}
				compact={compact}
				contentWidth={contentWidth}
				mouse={mouse}
				onApiKeyInput={state.handleApiKeyInput}
				onSubmit={state.saveByoApiKey}
			/>
		);
	}

	if (state.step === "byo_provider") {
		return (
			<OnboardingProviderPickerScreen
				compact={compact}
				contentWidth={contentWidth}
				mouse={mouse}
				providerList={state.providerList}
				providersLoading={state.providersLoading}
			/>
		);
	}

	if (state.step === "cline_model") {
		return (
			<OnboardingClineModelScreen
				clineEntries={state.clineEntries}
				clineKnownModels={state.clineKnownModels}
				clineModelSelected={state.clineModelSelected}
				compact={compact}
				contentWidth={contentWidth}
				mouse={mouse}
				recommendedLoading={state.recommendedLoading}
			/>
		);
	}

	if (state.step === "model_picker") {
		return (
			<OnboardingModelPickerScreen
				activeProviderName={state.activeProviderName}
				compact={compact}
				contentWidth={contentWidth}
				modelItems={state.modelItems}
				modelList={state.modelList}
				modelsLoading={state.modelsLoading}
				mouse={mouse}
			/>
		);
	}

	if (state.step === "thinking_level") {
		return (
			<OnboardingThinkingLevelScreen
				compact={compact}
				contentWidth={contentWidth}
				mouse={mouse}
				selectedModelName={state.selectedModelName}
				thinkingSelected={state.thinkingSelected}
			/>
		);
	}

	return (
		<OnboardingMainMenuScreen
			contentWidth={contentWidth}
			menuSelected={state.menuSelected}
			mouse={mouse}
		/>
	);
}
