import { getClineEnvironmentConfig } from "@cline/shared";

export const CLINE_NOT_SUBSCRIBED_RESPONSE_MESSAGE =
	"the user is not subscribed to required model plan";
const CLINE_NOT_SUBSCRIBED_FORMATTED_MESSAGE_PREFIX =
	"no access to clinepass subscription models yet. subscribe to clinepass";
export const CLINE_ORG_INDIVIDUAL_INFERENCE_SUBSCRIPTION_RESPONSE_MESSAGE =
	"organization accounts cannot use individual model inference subscriptions";
export const CLINE_PASS_LIMIT_RESPONSE_PATTERN =
	/you have reached your\s+[^.]+?\s+clinepass limit\.\s*the limit resets in\s+[^,]+,\s*please try again later\.?/i;

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

export class ClinePassLimitError extends Error {
	public readonly providerId?: string;

	constructor(message: string, providerId?: string) {
		super(message);
		this.name = "ClinePassLimitError";
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

export function isClinePassLimitError(
	error: unknown,
): error is ClinePassLimitError {
	return error instanceof ClinePassLimitError;
}

export function isClineNotSubscribedMessage(text: string): boolean {
	const normalized = text.trim().toLowerCase();
	return (
		normalized.includes(CLINE_NOT_SUBSCRIBED_RESPONSE_MESSAGE) ||
		normalized.includes(CLINE_NOT_SUBSCRIBED_FORMATTED_MESSAGE_PREFIX)
	);
}

export function isClineOrgIndividualInferenceSubscriptionMessage(
	text: string,
): boolean {
	return text
		.toLowerCase()
		.includes(CLINE_ORG_INDIVIDUAL_INFERENCE_SUBSCRIPTION_RESPONSE_MESSAGE);
}

export function isClinePassLimitMessage(text: string): boolean {
	return CLINE_PASS_LIMIT_RESPONSE_PATTERN.test(text.trim());
}

export function extractClinePassLimitMessage(text: string): string | undefined {
	return text.match(CLINE_PASS_LIMIT_RESPONSE_PATTERN)?.[0];
}
