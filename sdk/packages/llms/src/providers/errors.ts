import { getClineEnvironmentConfig } from "@cline/shared";

export const CLINE_NOT_SUBSCRIBED_RESPONSE_MESSAGE =
	"the user is not subscribed to required model plan";
const CLINE_NOT_SUBSCRIBED_FORMATTED_MESSAGE_PREFIX =
	"no access to clinepass subscription models yet. subscribe to clinepass";
export const CLINE_ORG_INDIVIDUAL_INFERENCE_SUBSCRIPTION_RESPONSE_MESSAGE =
	"organization accounts cannot use individual model inference subscriptions";

const CLINE_PASS_LIMIT_PREFIX = "you have reached your";
const CLINE_PASS_LIMIT_MARKER = "clinepass limit";
const CLINE_PASS_LIMIT_SUFFIX = "please try again later.";

function findClinePassLimitMessageBounds(
	text: string,
): { start: number; end: number } | undefined {
	const normalized = text.toLowerCase();
	const start = normalized.indexOf(CLINE_PASS_LIMIT_PREFIX);
	if (start === -1) {
		return undefined;
	}

	const suffixStart = normalized.indexOf(CLINE_PASS_LIMIT_SUFFIX, start);
	if (suffixStart === -1) {
		return undefined;
	}

	const end = suffixStart + CLINE_PASS_LIMIT_SUFFIX.length;
	if (!normalized.slice(start, end).includes(CLINE_PASS_LIMIT_MARKER)) {
		return undefined;
	}

	return { start, end };
}

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
	return findClinePassLimitMessageBounds(text) !== undefined;
}

export function extractClinePassLimitMessage(text: string): string | undefined {
	const bounds = findClinePassLimitMessageBounds(text);
	return bounds ? text.slice(bounds.start, bounds.end) : undefined;
}
