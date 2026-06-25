import { getClineEnvironmentConfig } from "@cline/shared";

export const CLINE_NOT_SUBSCRIBED_RESPONSE_MESSAGE =
	"the user is not subscribed to required model plan";
export const CLINE_ORG_INDIVIDUAL_INFERENCE_SUBSCRIPTION_RESPONSE_MESSAGE =
	"organization accounts cannot use individual model inference subscriptions";

export function getClinePassSubscriptionUrl(): string {
	return `${new URL(
		"/dashboard/subscription?personal=true",
		getClineEnvironmentConfig().appBaseUrl,
	).toString()}`;
}

export function getClineNotSubscribedMessage(): string {
	return `No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: ${getClinePassSubscriptionUrl()}`;
}

export class ClineNotSubscribedError extends Error {
	public readonly providerId?: string;

	constructor(providerId?: string) {
		super(getClineNotSubscribedMessage());
		this.name = "ClineNotSubscribedError";
		this.providerId = providerId;
	}
}

export function getClineOrgIndividualInferenceSubscriptionMessage(): string {
	return "Organization accounts cannot use ClinePass subscriptions. Go to /account -> change account to switch to your personal account for ClinePass";
}

export class ClineOrgIndividualInferenceSubscriptionError extends Error {
	public readonly providerId?: string;

	constructor(providerId?: string) {
		super(getClineOrgIndividualInferenceSubscriptionMessage());
		this.name = "ClineOrgIndividualInferenceSubscriptionError";
		this.providerId = providerId;
	}
}

export function isClineNotSubscribedError(
	error: unknown,
): error is ClineNotSubscribedError {
	return error instanceof ClineNotSubscribedError;
}

export function isClineOrgIndividualInferenceSubscriptionError(
	error: unknown,
): error is ClineOrgIndividualInferenceSubscriptionError {
	return error instanceof ClineOrgIndividualInferenceSubscriptionError;
}

export function isClineNotSubscribedMessage(text: string): boolean {
	return text.toLowerCase().includes(CLINE_NOT_SUBSCRIBED_RESPONSE_MESSAGE);
}

export function isClineOrgIndividualInferenceSubscriptionMessage(
	text: string,
): boolean {
	return text
		.toLowerCase()
		.includes(CLINE_ORG_INDIVIDUAL_INFERENCE_SUBSCRIPTION_RESPONSE_MESSAGE);
}
