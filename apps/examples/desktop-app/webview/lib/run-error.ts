/** The same presentation for live failures and restored transcript errors. */
export function formatRunError(detail: string): string {
	const description = detail.trim();
	if (description.startsWith("The run failed")) return description;
	const looksCredentialRelated =
		!description ||
		/unauthorized|401|403|forbidden|api key|credential|authentication|sign in|auth token|access token|invalid token|expired token|token expired/i.test(
			description,
		);
	return [
		description
			? `The run failed: ${description}`
			: "The run failed before a response was produced.",
		looksCredentialRelated
			? "Check your model connection in Settings → Models (or sign in with Cline), then try again."
			: "",
	]
		.filter(Boolean)
		.join(" ");
}
