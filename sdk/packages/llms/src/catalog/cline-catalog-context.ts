import { type ClientContext, getClineEnvironmentConfig } from "@cline/shared";
import { buildClineClientHeaders } from "../providers/cline-client-headers";

export interface ClineCatalogContext {
	client?: ClientContext;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
}
const transports = new WeakMap<typeof fetch, number>();
let nextTransport = 0;
export function clineCatalogBaseUrl(context: ClineCatalogContext): string {
	return (context.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl)
		.replace(/\/+$/, "")
		.replace(/\/api\/v1$/, "");
}
export function clineCatalogCacheKey(context: ClineCatalogContext): string {
	const transport = context.fetchImpl ?? globalThis.fetch;
	let id = transports.get(transport);
	if (id === undefined) {
		id = ++nextTransport;
		transports.set(transport, id);
	}
	return JSON.stringify([
		clineCatalogBaseUrl(context),
		buildClineClientHeaders(context.client),
		id,
	]);
}
