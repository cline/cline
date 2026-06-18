export const CLINE_NOT_SUBSCRIBED_MESSAGE =
	"the user is not subscribed to required model plan";

export class ClineNotSubscribedError extends Error {
	public readonly providerId?: string;

	constructor(providerId?: string) {
		super(CLINE_NOT_SUBSCRIBED_MESSAGE);
		this.name = "ClineNotSubscribedError";
		this.providerId = providerId;
	}
}

export function isClineNotSubscribedError(
	error: unknown,
): error is ClineNotSubscribedError {
	return error instanceof ClineNotSubscribedError;
}

export function isClineNotSubscribedMessage(
	text: string,
	message = CLINE_NOT_SUBSCRIBED_MESSAGE,
): boolean {
	return text.toLowerCase().includes(message.toLowerCase());
}
