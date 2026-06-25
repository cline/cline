import {
	getClineNotSubscribedMessage,
	getClineOrgIndividualInferenceSubscriptionMessage,
	isClineNotSubscribedMessage,
	isClineOrgIndividualInferenceSubscriptionMessage,
} from "@cline/llms"

export function isClinePassSubscriptionErrorMessage(message?: string): boolean {
	return message === getClineNotSubscribedMessage() || (message ? isClineNotSubscribedMessage(message) : false)
}

export function isClineOrgIndividualInferenceSubscriptionErrorMessage(message?: string): boolean {
	return (
		message === getClineOrgIndividualInferenceSubscriptionMessage() ||
		(message ? isClineOrgIndividualInferenceSubscriptionMessage(message) : false)
	)
}
