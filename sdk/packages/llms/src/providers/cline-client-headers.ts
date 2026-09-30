import type { ClientContext } from "@cline/shared";

/** Client identity shared by catalog and inference requests. */
export function buildClineClientHeaders(
	client?: Partial<ClientContext>,
): Record<string, string> {
	const clientType = client?.name?.trim() || "cline-sdk";
	const version = client?.version?.trim() || "unknown";
	return {
		"HTTP-Referer": "https://cline.bot",
		"X-Title": "Cline",
		"User-Agent": `Cline/${version}`,
		"X-IS-MULTIROOT": client?.isMultiRoot === true ? "true" : "false",
		"X-CLIENT-TYPE": clientType,
		"X-CLIENT-VERSION": version,
		"X-PLATFORM": client?.platform?.trim() || clientType,
		"X-PLATFORM-VERSION": client?.platformVersion?.trim() || version,
	};
}
