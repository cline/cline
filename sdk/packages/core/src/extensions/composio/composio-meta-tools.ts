/**
 * In-chat authentication for Composio connectors.
 *
 * The Cline API creates a per-user Composio tool-router session scoped to the
 * project's enabled auth configs (`POST /api/v1/connectors/meta-tools/sessions`)
 * and returns the schemas of its allowlisted meta tools: COMPOSIO_SEARCH_TOOLS
 * finds tools across those toolkits, COMPOSIO_MANAGE_CONNECTIONS returns a
 * hosted Connect Link the agent surfaces in chat, COMPOSIO_WAIT_FOR_CONNECTIONS
 * blocks until the user finishes, and COMPOSIO_MULTI_EXECUTE_TOOL runs the
 * tools search found — no new session needed after connecting.
 * Credentials never pass through Cline or the model — only the link does.
 * Executions go back through the proxy with the session id
 * (`POST /api/v1/connectors/meta-tools/{slug}/execute`), which checks that the
 * session belongs to the caller.
 */

export const CONNECTORS_API_PATH = "/api/v1/connectors";

/** Session creation runs during session bootstrap, so it must not stall it. */
const META_TOOL_SESSION_TIMEOUT_MS = 5_000;

// These tools form one search/connect/execute flow. Their provider descriptions
// reference each other, so a partial session cannot be exposed to the agent.
const REQUIRED_META_TOOL_SLUGS = [
	"COMPOSIO_SEARCH_TOOLS",
	"COMPOSIO_MANAGE_CONNECTIONS",
	"COMPOSIO_WAIT_FOR_CONNECTIONS",
	"COMPOSIO_MULTI_EXECUTE_TOOL",
] as const;

/** The host owns the API origin and user authentication for connector requests. */
export type ConnectorsRequest = (
	path: string,
	init: RequestInit,
) => Promise<Response>;

export type ComposioMetaTool = {
	slug: string;
	name?: string;
	description?: string;
	input_parameters?: Record<string, unknown>;
};

export type ComposioMetaToolSession = {
	sessionId: string;
	tools: ComposioMetaTool[];
};

/**
 * Creates a meta-tool session, or returns undefined when in-chat auth is
 * unavailable: no connectable toolkits (404), a proxy without the endpoint, or
 * any network failure. Callers then run without the meta tools.
 */
export async function createComposioMetaToolSession(
	request: ConnectorsRequest,
	options?: { log?: (message: string) => void },
): Promise<ComposioMetaToolSession | undefined> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const pendingResponse = request(
			`${CONNECTORS_API_PATH}/meta-tools/sessions`,
			{
				method: "POST",
				signal: AbortSignal.timeout(META_TOOL_SESSION_TIMEOUT_MS),
			},
		);
		const deadline = new Promise<never>((_, reject) => {
			timeout = setTimeout(
				() => reject(new Error("Connector discovery timed out")),
				META_TOOL_SESSION_TIMEOUT_MS,
			);
		});
		const response = await Promise.race([pendingResponse, deadline]);
		if (!response.ok) {
			if (response.status !== 404) {
				options?.log?.(
					`composio-tools: meta-tool session returned HTTP ${response.status}`,
				);
			}
			return undefined;
		}
		const parsed = (await Promise.race([
			response.json().catch(() => undefined),
			deadline,
		])) as {
			data?: { sessionId?: unknown; tools?: unknown };
		};
		const sessionId = parsed?.data?.sessionId;
		const tools = parsed?.data?.tools;
		if (typeof sessionId !== "string" || !sessionId || !Array.isArray(tools)) {
			return undefined;
		}
		const metaTools = tools.filter(
			(tool): tool is ComposioMetaTool =>
				typeof tool?.slug === "string" &&
				REQUIRED_META_TOOL_SLUGS.some((slug) => slug === tool.slug),
		);
		const slugs = new Set(metaTools.map((tool) => tool.slug));
		const missing = REQUIRED_META_TOOL_SLUGS.filter((slug) => !slugs.has(slug));
		if (missing.length > 0) {
			options?.log?.(
				`composio-tools: meta-tool session missing required tools: ${missing.join(", ")}`,
			);
			return undefined;
		}
		return {
			sessionId,
			tools: [...new Map(metaTools.map((tool) => [tool.slug, tool])).values()],
		};
	} catch (error) {
		options?.log?.(
			`composio-tools: meta-tool session request failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	} finally {
		clearTimeout(timeout);
	}
}

export async function executeComposioMetaTool(
	request: ConnectorsRequest,
	sessionId: string,
	slug: string,
	input: unknown,
): Promise<unknown> {
	const url = `${CONNECTORS_API_PATH}/meta-tools/${encodeURIComponent(slug)}/execute`;
	let response: Response;
	try {
		response = await request(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId,
				arguments: input && typeof input === "object" ? input : {},
			}),
		});
	} catch (error) {
		return {
			successful: false,
			error: `Cline connectors request failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	const text = await response.text();
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : undefined;
	} catch {
		parsed = undefined;
	}
	if (!response.ok) {
		const preview =
			parsed !== undefined
				? JSON.stringify(parsed).slice(0, 600)
				: text.slice(0, 600);
		return {
			successful: false,
			error: `Cline connectors proxy returned HTTP ${response.status} for ${slug}${preview ? `: ${preview}` : ""}`,
		};
	}
	return parsed ?? { successful: true };
}
