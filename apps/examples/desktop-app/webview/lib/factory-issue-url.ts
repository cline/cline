export type FactoryIssueUrl =
	| { provider: "github"; url: string }
	| {
			provider: "linear";
			workspace: string;
			identifier: string;
			url: string;
	  };

function readFactoryIssueUrl(input: string): FactoryIssueUrl | undefined {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.port) {
		return undefined;
	}
	if (url.hostname === "github.com") {
		const match = /^\/([\w.-]+)\/([\w.-]+)\/issues\/([1-9]\d*)\/?$/.exec(
			url.pathname,
		);
		if (match) {
			return {
				provider: "github",
				url: `https://github.com/${match[1]}/${match[2]}/issues/${match[3]}`,
			};
		}
	}
	if (url.hostname === "linear.app") {
		const match =
			/^\/([\w-]+)\/issue\/([a-z\d]+-[1-9]\d*)(?:\/[^/]+)?\/?$/i.exec(
				url.pathname,
			);
		if (match) {
			return {
				provider: "linear",
				workspace: match[1].toLowerCase(),
				identifier: match[2].toUpperCase(),
				url: `https://linear.app/${match[1].toLowerCase()}/issue/${match[2].toUpperCase()}`,
			};
		}
	}
	return undefined;
}

/** Canonical GitHub or Linear issue URL; throws for anything else. */
export function parseFactoryIssueUrl(input: string): FactoryIssueUrl {
	const parsed = readFactoryIssueUrl(input);
	if (!parsed) throw new Error("Enter a GitHub or Linear issue URL.");
	return parsed;
}

/** An issue is imported only when the complete request is an issue URL. */
export function findFactoryIssueUrl(text: string): string | undefined {
	return readFactoryIssueUrl(text.trim())?.url;
}
