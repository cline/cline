import { resolveCredentialFailureHint } from "@/hooks/chat-session/helpers";

/** The same presentation for live failures and restored transcript errors. */
export function formatRunError(detail: string, providerId = ""): string {
	const description = detail.trim();
	const guidance = resolveCredentialFailureHint(providerId);
	const looksCredentialRelated =
		!description ||
		/unauthorized|401|403|forbidden|api key|credential|authenticat|sign in|auth token|access token|invalid token|expired token|token expired|session expired|not logged in|\/login/i.test(
			description,
		);
	return [
		description
			? description.startsWith("The run failed")
				? description
				: `The run failed: ${description}`
			: "The run failed before a response was produced.",
		looksCredentialRelated && !description.includes(guidance) ? guidance : "",
	]
		.filter(Boolean)
		.join(" ");
}
