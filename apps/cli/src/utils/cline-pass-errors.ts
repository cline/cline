import {
	type ClineSubscriptionPlan,
	extractClineFreeModelLimitResetTime,
	extractClinePassLimitMessage,
	getClineOrgIndividualInferenceSubscriptionMessage,
	isClineFreeModelLimitError,
	isClineFreeModelLimitMessage,
	isClineModelNotFoundMessage,
	isClineNotSubscribedError,
	isClineNotSubscribedMessage,
	isClineOrgIndividualInferenceSubscriptionError,
	isClineOrgIndividualInferenceSubscriptionMessage,
	isClinePassLimitError,
	isClinePassLimitMessage,
} from "@cline/core";

import { getClineEnvironmentConfig } from "@cline/shared";

export { getClineOrgIndividualInferenceSubscriptionMessage };

export function getCliSubscriptionUrl(): string {
	return new URL(
		`/dashboard/subscription?personal=true`,
		getClineEnvironmentConfig().appBaseUrl,
	).toString();
}

export function getCliNotSubscribedMessage(): string {
	return `No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: ${getCliSubscriptionUrl()}`;
}

export function getCliClinePassLimitMessage(message: string): string {
	const detail = getClinePassLimitDetailMessage(message) ?? message.trim();
	const lines = [
		"ClinePass limit reached",
		detail,
		"Switch to Cline usage-based billing and retry with the Cline provider.",
		"Interactive CLI: open the model selector with /model, choose Cline, then retry.",
		"Headless CLI: rerun with --provider cline.",
	];
	return lines.filter((line) => line.trim().length > 0).join("\n");
}

const CLINE_FREE_MODEL_PREFIX = "cline-free/";
const CLINE_FREE_PROMOTION_ENDED_HEADER = "Free model promotion ended";
const CLINE_FREE_MODEL_LIMIT_HEADER = "Daily free model limit reached";

export function getCliClineFreePromotionEndedMessage(): string {
	return [
		CLINE_FREE_PROMOTION_ENDED_HEADER,
		"The free promotion for this model has ended and it is no longer available.",
		"Select another model to continue.",
		"Open the model selector with /model.",
	].join("\n");
}

export function getCliClineFreeModelLimitMessage(message: string): string {
	const resetTime = extractClineFreeModelLimitResetTime(message);
	return [
		CLINE_FREE_MODEL_LIMIT_HEADER,
		"You've reached today's free usage limit for this model.",
		resetTime
			? `Try again in ${resetTime} or select another model.`
			: "Try again later or select another model.",
		"Open the model selector with /model.",
	].join("\n");
}

export function getIndividualPlanFeatures(
	plans: ClineSubscriptionPlan[],
): string[] {
	const planWithFeatures = plans.find((plan) => plan.interval === "Monthly");

	return planWithFeatures?.features?.included ?? [];
}

function isFormattedClinePassSubscriptionMessage(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	return (
		normalized.includes("no access to clinepass subscription models yet") &&
		normalized.includes("subscribe to clinepass")
	);
}

export function isClinePassSubscriptionError(error: unknown): boolean {
	if (isClineNotSubscribedError(error)) {
		return true;
	}
	if (error instanceof Error) {
		return (
			error.name === "ClineNotSubscribedError" ||
			isClineNotSubscribedMessage(error.message) ||
			isFormattedClinePassSubscriptionMessage(error.message)
		);
	}
	return (
		typeof error === "string" &&
		(isClineNotSubscribedMessage(error) ||
			isFormattedClinePassSubscriptionMessage(error))
	);
}

export function isClineOrgIndividualInferenceSubscriptionErrorMessage(
	error: unknown,
): boolean {
	if (isClineOrgIndividualInferenceSubscriptionError(error)) {
		return true;
	}
	if (error instanceof Error) {
		return (
			error.name === "ClineOrgIndividualInferenceSubscriptionError" ||
			isClineOrgIndividualInferenceSubscriptionMessage(error.message) ||
			error.message === getClineOrgIndividualInferenceSubscriptionMessage()
		);
	}
	return (
		typeof error === "string" &&
		(isClineOrgIndividualInferenceSubscriptionMessage(error) ||
			error === getClineOrgIndividualInferenceSubscriptionMessage())
	);
}

export function getClinePassLimitDetailMessage(
	error: unknown,
): string | undefined {
	return extractClinePassLimitMessage(
		error instanceof Error ? error.message : String(error),
	);
}

export function isClinePassLimitErrorMessage(error: unknown): boolean {
	if (isClinePassLimitError(error)) {
		return true;
	}
	if (error instanceof Error) {
		return (
			error.name === "ClinePassLimitError" ||
			isClinePassLimitMessage(error.message)
		);
	}
	return typeof error === "string" && isClinePassLimitMessage(error);
}

// Detects that a deleted free model was requested: the backend answers "model
// not found" once a free promotion ends and the cline-free/ model is removed.
// The modelId gate keeps regular model-not-found errors on their generic path.
export function isClineFreePromotionEndedErrorMessage(
	error: unknown,
	modelId?: string,
): boolean {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "";
	if (
		message
			.toLowerCase()
			.includes(CLINE_FREE_PROMOTION_ENDED_HEADER.toLowerCase())
	) {
		return true;
	}
	if (!modelId?.startsWith(CLINE_FREE_MODEL_PREFIX)) {
		return false;
	}
	return isClineModelNotFoundMessage(message);
}

export function isClineFreeModelLimitErrorMessage(error: unknown): boolean {
	if (isClineFreeModelLimitError(error)) {
		return true;
	}
	if (error instanceof Error) {
		return (
			error.name === "ClineFreeModelLimitError" ||
			isClineFreeModelLimitMessage(error.message)
		);
	}
	return (
		typeof error === "string" &&
		(error
			.toLowerCase()
			.includes(CLINE_FREE_MODEL_LIMIT_HEADER.toLowerCase()) ||
			isClineFreeModelLimitMessage(error))
	);
}

export function formatCliErrorMessage(
	error: unknown,
	options?: { modelId?: string },
): string {
	if (isClinePassSubscriptionError(error)) {
		return getCliNotSubscribedMessage();
	}
	if (isClineOrgIndividualInferenceSubscriptionErrorMessage(error)) {
		return getClineOrgIndividualInferenceSubscriptionMessage();
	}
	if (isClinePassLimitErrorMessage(error)) {
		return getCliClinePassLimitMessage(
			error instanceof Error ? error.message : String(error),
		);
	}
	if (isClineFreeModelLimitErrorMessage(error)) {
		return getCliClineFreeModelLimitMessage(
			error instanceof Error ? error.message : String(error),
		);
	}
	if (isClineFreePromotionEndedErrorMessage(error, options?.modelId)) {
		return getCliClineFreePromotionEndedMessage();
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
