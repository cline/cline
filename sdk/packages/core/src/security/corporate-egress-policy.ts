import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const EGRESS_DATA_CLASSES = [
	"PUBLIC",
	"WORKSPACE_SENSITIVE",
	"SECRET",
	"UNTRUSTED_WEB",
] as const;

export type EgressDataClass = (typeof EGRESS_DATA_CLASSES)[number];

export const EGRESS_SINKS = [
	"BEDROCK_INFERENCE",
	"AWS_AUTH",
	"AWS_CONTROL_PLANE",
	"PUBLIC_RESEARCH",
	"LOCAL_LOG",
] as const;

export type EgressSink = (typeof EGRESS_SINKS)[number];

export type ResearchHttpMethod = "GET" | "HEAD";

export interface EgressAuditEvent {
	timestamp: string;
	operation: "research-fetch";
	destination: string;
	method: ResearchHttpMethod;
	decision: "allow" | "deny";
	redirectCount: number;
	responseBytes?: number;
	reason?: string;
}

export interface ResearchDnsAddress {
	address: string;
	family: number;
}

export interface CorporateResearchRequestOptions {
	method?: ResearchHttpMethod;
	timeoutMs?: number;
	maxResponseBytes?: number;
	maxRedirects?: number;
	signal?: AbortSignal;
	fetch?: typeof globalThis.fetch;
	resolveDns?: (hostname: string) => Promise<readonly ResearchDnsAddress[]>;
	audit?: (event: EgressAuditEvent) => void;
	allowedContentTypes?: readonly RegExp[];
}

export interface CorporateResearchResponse {
	url: string;
	status: number;
	statusText: string;
	headers: Headers;
	body: Uint8Array;
	redirectCount: number;
}

export class CorporateEgressPolicyError extends Error {
	constructor(
		message: string,
		readonly code:
			| "DATA_CLASS_DENIED"
			| "INVALID_QUERY"
			| "INVALID_URL"
			| "PRIVATE_DESTINATION"
			| "REDIRECT_DENIED"
			| "RESPONSE_DENIED"
			| "RESPONSE_TOO_LARGE"
			| "TIMEOUT",
	) {
		super(message);
		this.name = "CorporateEgressPolicyError";
	}
}

const ALLOWED_DATA_CLASSES: Record<EgressSink, ReadonlySet<EgressDataClass>> = {
	BEDROCK_INFERENCE: new Set([
		"PUBLIC",
		"WORKSPACE_SENSITIVE",
		"UNTRUSTED_WEB",
	]),
	AWS_AUTH: new Set(["PUBLIC", "SECRET"]),
	AWS_CONTROL_PLANE: new Set(["PUBLIC"]),
	PUBLIC_RESEARCH: new Set(["PUBLIC"]),
	LOCAL_LOG: new Set(["PUBLIC"]),
};

const DEFAULT_ALLOWED_CONTENT_TYPES = [
	/^text\/html(?:;|$)/i,
	/^application\/xhtml\+xml(?:;|$)/i,
	/^text\/plain(?:;|$)/i,
	/^application\/json(?:;|$)/i,
	/^application\/xml(?:;|$)/i,
	/^text\/xml(?:;|$)/i,
] as const;

const GENERIC_RESEARCH_USER_AGENT = "BedrockCoder-Research/1.0";
const MAX_PUBLIC_QUERY_LENGTH = 200;
const MAX_PUBLIC_URL_LENGTH = 2_048;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const METADATA_HOSTNAMES = new Set([
	"metadata",
	"metadata.google.internal",
	"instance-data",
]);

const SECRET_PATTERNS: readonly RegExp[] = [
	/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/i,
	/\baws_(?:secret_access_key|session_token)\b/i,
	/\b(?:authorization|proxy-authorization)\s*[:=]/i,
	/\bbearer\s+[a-z0-9._~+/=-]{12,}\b/i,
	/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
	/\b(?:client_secret|access_token|refresh_token|webhook_token)\s*[:=]/i,
];

const WORKSPACE_PATH_PATTERNS: readonly RegExp[] = [
	/(?:^|[\s"'(])(?:[a-zA-Z]:[\\/])(?:[^ \r\n"'<>|*?]+[\\/]?)+/,
	/(?:^|[\s"'(])\/(?:Users|home|workspace|workspaces|private|var\/folders)\/[^\s"'<>]+/,
	/\bfile:\/\//i,
];

const CODE_PATTERNS: readonly RegExp[] = [
	/```/,
	/(?:^|\s)(?:import|export|class|function|interface|const|let|var)\s+[A-Za-z_$]/,
	/[{}]\s*(?:=>|;)/,
];

const ENCODED_PAYLOAD_PATTERNS: readonly RegExp[] = [
	/(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{48,}={0,2}(?:$|[^A-Za-z0-9+/])/,
	/(?:^|[^A-Fa-f0-9])[A-Fa-f0-9]{64,}(?:$|[^A-Fa-f0-9])/,
];

export function assertEgressDataClassAllowed(
	sink: EgressSink,
	dataClass: EgressDataClass,
): void {
	if (!ALLOWED_DATA_CLASSES[sink].has(dataClass)) {
		throw new CorporateEgressPolicyError(
			`${dataClass} data is not permitted at the ${sink} sink.`,
			"DATA_CLASS_DENIED",
		);
	}
}

function sensitivePublicInputReason(value: string): string | undefined {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Rejecting C0 control characters is the purpose of this validation.
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
		return "control characters are not allowed";
	}
	for (const pattern of SECRET_PATTERNS) {
		if (pattern.test(value)) {
			return "credential or authorization material is not allowed";
		}
	}
	for (const pattern of WORKSPACE_PATH_PATTERNS) {
		if (pattern.test(value)) {
			return "local or workspace paths are not allowed";
		}
	}
	for (const pattern of CODE_PATTERNS) {
		if (pattern.test(value)) {
			return "source-code-shaped text is not allowed";
		}
	}
	for (const pattern of ENCODED_PAYLOAD_PATTERNS) {
		if (pattern.test(value)) {
			return "long encoded payloads are not allowed";
		}
	}
	return undefined;
}

export function sanitizePublicSearchQuery(
	query: string,
	dataClass: EgressDataClass = "PUBLIC",
): string {
	assertEgressDataClassAllowed("PUBLIC_RESEARCH", dataClass);
	const normalized = query.trim().replace(/\s+/g, " ");
	if (!normalized) {
		throw new CorporateEgressPolicyError(
			"Public research query must not be empty.",
			"INVALID_QUERY",
		);
	}
	if (normalized.length > MAX_PUBLIC_QUERY_LENGTH) {
		throw new CorporateEgressPolicyError(
			`Public research query exceeds ${MAX_PUBLIC_QUERY_LENGTH} characters.`,
			"INVALID_QUERY",
		);
	}
	const reason = sensitivePublicInputReason(normalized);
	if (reason) {
		throw new CorporateEgressPolicyError(
			`Public research query rejected: ${reason}.`,
			"INVALID_QUERY",
		);
	}
	return normalized;
}

export function buildPublicSearchUrl(
	searchEndpoint: string,
	query: string,
	dataClass: EgressDataClass = "PUBLIC",
): URL {
	const endpoint = validatePublicResearchUrl(searchEndpoint);
	if (endpoint.search || endpoint.hash) {
		throw new CorporateEgressPolicyError(
			"Search endpoint must not contain an existing query or fragment.",
			"INVALID_URL",
		);
	}
	endpoint.searchParams.set("q", sanitizePublicSearchQuery(query, dataClass));
	return endpoint;
}

function validatePublicQueryParameters(url: URL): void {
	for (const [name, value] of url.searchParams) {
		if (name.length > 100 || value.length > MAX_PUBLIC_QUERY_LENGTH) {
			throw new CorporateEgressPolicyError(
				"Public URL contains an oversized query field.",
				"INVALID_URL",
			);
		}
		const reason = sensitivePublicInputReason(`${name} ${value}`);
		if (reason) {
			throw new CorporateEgressPolicyError(
				`Public URL query rejected: ${reason}.`,
				"INVALID_URL",
			);
		}
	}
}

export function validatePublicResearchUrl(input: string | URL): URL {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new CorporateEgressPolicyError(
			"Research destination is not a valid URL.",
			"INVALID_URL",
		);
	}
	if (url.toString().length > MAX_PUBLIC_URL_LENGTH) {
		throw new CorporateEgressPolicyError(
			`Research URL exceeds ${MAX_PUBLIC_URL_LENGTH} characters.`,
			"INVALID_URL",
		);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new CorporateEgressPolicyError(
			"Research navigation permits only HTTP and HTTPS.",
			"INVALID_URL",
		);
	}
	if (url.username || url.password) {
		throw new CorporateEgressPolicyError(
			"Credentials embedded in research URLs are prohibited.",
			"INVALID_URL",
		);
	}
	if (
		(url.protocol === "http:" && url.port && url.port !== "80") ||
		(url.protocol === "https:" && url.port && url.port !== "443")
	) {
		throw new CorporateEgressPolicyError(
			"Research navigation permits only standard HTTP and HTTPS ports.",
			"INVALID_URL",
		);
	}
	const hostname = url.hostname
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
		.replace(/\.$/, "");
	if (
		!hostname ||
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname.endsWith(".local") ||
		hostname.endsWith(".internal") ||
		METADATA_HOSTNAMES.has(hostname)
	) {
		throw new CorporateEgressPolicyError(
			"Local, internal, and metadata research destinations are prohibited.",
			"PRIVATE_DESTINATION",
		);
	}
	let decodedPath: string;
	try {
		decodedPath = decodeURIComponent(url.pathname);
	} catch {
		throw new CorporateEgressPolicyError(
			"Research URL path contains invalid percent encoding.",
			"INVALID_URL",
		);
	}
	const componentReason = sensitivePublicInputReason(
		`${hostname} ${decodedPath}`,
	);
	if (componentReason) {
		throw new CorporateEgressPolicyError(
			`Public URL destination rejected: ${componentReason}.`,
			"INVALID_URL",
		);
	}
	validatePublicQueryParameters(url);
	url.hash = "";
	return url;
}

function parseIpv4(address: string): number[] | undefined {
	const octets = address.split(".").map((part) => Number(part));
	if (
		octets.length !== 4 ||
		octets.some(
			(octet, index) =>
				!Number.isInteger(octet) ||
				octet < 0 ||
				octet > 255 ||
				String(octet) !== address.split(".")[index],
		)
	) {
		return undefined;
	}
	return octets;
}

function isPublicIpv4(address: string): boolean {
	const octets = parseIpv4(address);
	if (!octets) {
		return false;
	}
	const [a, b, c] = octets;
	if (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		a >= 224
	) {
		return false;
	}
	// Unspecified/reserved and documentation-only ranges are not valid public
	// research destinations.
	if (
		(a === 192 && b === 0 && c === 0) ||
		(a === 192 && b === 0 && c === 2) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113)
	) {
		return false;
	}
	return true;
}

function isPublicIpv6(address: string): boolean {
	const normalized = address
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
		.split("%", 1)[0];
	if (isIP(normalized) !== 6) {
		return false;
	}
	// Be conservative: globally routable unicast currently lives in 2000::/3.
	// This also rejects loopback, ULA, link-local, multicast, transition, and
	// IPv4-mapped forms without relying on ambiguous textual expansion.
	const firstHextet = Number.parseInt(normalized.split(":", 1)[0], 16);
	if (
		!Number.isInteger(firstHextet) ||
		firstHextet < 0x2000 ||
		firstHextet > 0x3fff
	) {
		return false;
	}
	// RFC 3849 documentation addresses must never be contacted.
	if (/^2001:0?db8(?:0*:|:)/.test(normalized)) {
		return false;
	}
	return true;
}

export function isPublicNetworkAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) {
		return isPublicIpv4(address);
	}
	if (family === 6) {
		return isPublicIpv6(address);
	}
	return false;
}

async function defaultResolveDns(
	hostname: string,
): Promise<readonly ResearchDnsAddress[]> {
	return await lookup(hostname, { all: true, verbatim: true });
}

async function assertPublicDestination(
	url: URL,
	resolveDns: NonNullable<CorporateResearchRequestOptions["resolveDns"]>,
): Promise<void> {
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	const literalFamily = isIP(hostname);
	const addresses = literalFamily
		? [{ address: hostname, family: literalFamily }]
		: await resolveDns(hostname);
	if (addresses.length === 0) {
		throw new CorporateEgressPolicyError(
			"Research destination did not resolve to an address.",
			"PRIVATE_DESTINATION",
		);
	}
	const denied = addresses.find(
		({ address }) => !isPublicNetworkAddress(address),
	);
	if (denied) {
		throw new CorporateEgressPolicyError(
			`Research destination resolved to a prohibited network address (${denied.address}).`,
			"PRIVATE_DESTINATION",
		);
	}
}

function emitAudit(
	audit: CorporateResearchRequestOptions["audit"],
	event: Omit<EgressAuditEvent, "timestamp" | "operation">,
): void {
	audit?.({
		timestamp: new Date().toISOString(),
		operation: "research-fetch",
		...event,
	});
}

function responseContentTypeAllowed(
	response: Response,
	allowedContentTypes: readonly RegExp[],
): boolean {
	const contentType = response.headers.get("content-type") ?? "";
	return allowedContentTypes.some((pattern) => pattern.test(contentType));
}

async function readBoundedBody(
	response: Response,
	maxResponseBytes: number,
): Promise<Uint8Array> {
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
		throw new CorporateEgressPolicyError(
			`Research response exceeds ${maxResponseBytes} bytes.`,
			"RESPONSE_TOO_LARGE",
		);
	}
	const reader = response.body?.getReader();
	if (!reader) {
		return new Uint8Array();
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		total += value.byteLength;
		if (total > maxResponseBytes) {
			await reader.cancel();
			throw new CorporateEgressPolicyError(
				`Research response exceeds ${maxResponseBytes} bytes.`,
				"RESPONSE_TOO_LARGE",
			);
		}
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

export async function corporateResearchRequest(
	input: string | URL,
	options: CorporateResearchRequestOptions = {},
): Promise<CorporateResearchResponse> {
	assertEgressDataClassAllowed("PUBLIC_RESEARCH", "PUBLIC");
	const method = options.method ?? "GET";
	if (method !== "GET" && method !== "HEAD") {
		throw new CorporateEgressPolicyError(
			"Corporate research permits only GET and HEAD requests.",
			"INVALID_URL",
		);
	}
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxResponseBytes =
		options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	const resolveDns = options.resolveDns ?? defaultResolveDns;
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const allowedContentTypes =
		options.allowedContentTypes ?? DEFAULT_ALLOWED_CONTENT_TYPES;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const abortFromCaller = () => controller.abort();
	options.signal?.addEventListener("abort", abortFromCaller, { once: true });

	let current = validatePublicResearchUrl(input);
	let redirectCount = 0;
	try {
		while (true) {
			await assertPublicDestination(current, resolveDns);
			const destination = current.origin;
			let response: Response;
			try {
				response = await fetchImpl(current, {
					method,
					headers: {
						Accept:
							"text/html,application/xhtml+xml,text/plain,application/json,application/xml;q=0.8",
						"User-Agent": GENERIC_RESEARCH_USER_AGENT,
					},
					body: undefined,
					cache: "no-store",
					credentials: "omit",
					redirect: "manual",
					referrerPolicy: "no-referrer",
					signal: controller.signal,
				});
			} catch (error) {
				if (controller.signal.aborted) {
					throw new CorporateEgressPolicyError(
						`Research request timed out or was cancelled after ${timeoutMs}ms.`,
						"TIMEOUT",
					);
				}
				throw error;
			}

			if (REDIRECT_STATUS_CODES.has(response.status)) {
				if (redirectCount >= maxRedirects) {
					throw new CorporateEgressPolicyError(
						`Research redirect limit (${maxRedirects}) exceeded.`,
						"REDIRECT_DENIED",
					);
				}
				const location = response.headers.get("location");
				if (!location) {
					throw new CorporateEgressPolicyError(
						"Research redirect omitted its destination.",
						"REDIRECT_DENIED",
					);
				}
				current = validatePublicResearchUrl(new URL(location, current));
				redirectCount += 1;
				continue;
			}

			if (!response.ok) {
				throw new CorporateEgressPolicyError(
					`Research destination returned HTTP ${response.status}.`,
					"RESPONSE_DENIED",
				);
			}
			if (
				method !== "HEAD" &&
				!responseContentTypeAllowed(response, allowedContentTypes)
			) {
				throw new CorporateEgressPolicyError(
					`Research response content type is not allowed (${response.headers.get("content-type") ?? "missing"}).`,
					"RESPONSE_DENIED",
				);
			}
			const body =
				method === "HEAD"
					? new Uint8Array()
					: await readBoundedBody(response, maxResponseBytes);
			emitAudit(options.audit, {
				destination,
				method,
				decision: "allow",
				redirectCount,
				responseBytes: body.byteLength,
			});
			return {
				url: current.toString(),
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
				body,
				redirectCount,
			};
		}
	} catch (error) {
		emitAudit(options.audit, {
			destination: current.origin,
			method,
			decision: "deny",
			redirectCount,
			reason:
				error instanceof CorporateEgressPolicyError
					? error.code
					: "request-failed",
		});
		throw error;
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener("abort", abortFromCaller);
	}
}
