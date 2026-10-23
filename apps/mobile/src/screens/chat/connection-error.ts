/**
 * Turns a raw connection `Error` into copy a person can act on, for the Chat
 * error state.
 *
 * ## What can and cannot be told apart
 *
 * This is a PRESENTATION-ONLY reading of the error object the connection layer
 * already hands the screen (`status.error`) — nothing new is plumbed, and the
 * match is structural (`name` / `code` / `details`) rather than `instanceof`, so
 * it stays independent of the hub-client module identity and is testable with
 * plain objects.
 *
 * The important limitation, checked against the hub server: an unauthorized
 * local hub rejects the **HTTP upgrade** with `401` (`hub-websocket-server.ts`
 * `rejectUnauthorizedUpgradeSocket`), so the websocket never opens and the
 * client raises exactly the same `HubTransportError("hub_connect_failed")` it
 * raises when nothing is listening at all. **For a local hub, "unreachable" and
 * "bad token" are therefore indistinguishable here** — no signal exists to split
 * them without new plumbing through the connection layer, which is out of scope.
 * `unreachable` copy consequently names both causes, and its escape hatch back
 * to the session list is also where the computer can be paired again.
 *
 * What IS distinguishable, and gets its own copy:
 *  - `hub_connect_timeout` → `timeout` (reachable, handshake never finished)
 *  - `hub_connection_closed` → `dropped` (socket had opened, then closed)
 *  - `incompatible_protocol` → `protocol` (terminal; retrying cannot help)
 *  - `CloudSessionApiError` 401/403 → `refused` (a genuine cloud auth failure,
 *    which unlike the local hub does report its status)
 */

import { errorDetail } from "@/error-message";

export type ConnectionErrorKind =
	| "missing"
	| "unreachable"
	| "timeout"
	| "dropped"
	| "refused"
	| "github"
	| "protocol"
	| "unknown";

export interface ConnectionErrorPresentation {
	kind: ConnectionErrorKind;
	/** Short human headline — no error codes, no punctuation soup. */
	headline: string;
	/** One line of explanation and/or what to do next. */
	body: string;
	/** The raw technical text, demoted into the `Details` disclosure. */
	detail?: string;
	/**
	 * False when retrying provably cannot help (a protocol mismatch), so the
	 * screen leads with the escape hatch instead of a button that will re-fail.
	 */
	retryable: boolean;
	action?: "sign-in" | "connect-github" | "new-chat";
}

const COPY: Record<
	ConnectionErrorKind,
	{ headline: string; body: string; retryable: boolean }
> = {
	missing: {
		headline: "This session is no longer available",
		body: "Cline could not find this exact conversation. Choose another session or start a new one.",
		retryable: false,
	},
	unreachable: {
		headline: "Can't reach this session",
		body: "Make sure Cline is running on your computer, then try again. You may need to pair this computer again.",
		retryable: true,
	},
	timeout: {
		headline: "Connection timed out",
		body: "The session did not finish connecting. This usually clears on a retry.",
		retryable: true,
	},
	dropped: {
		headline: "Connection dropped",
		body: "Reconnecting should pick the session back up where it stopped.",
		retryable: true,
	},
	refused: {
		headline: "This device isn't authorized",
		body: "Sign in again, or pair this computer again to renew access.",
		retryable: true,
	},
	github: {
		headline: "Connect GitHub to continue",
		body: "Connect GitHub to your Cline account, then return here and retry.",
		retryable: true,
	},
	protocol: {
		headline: "Version mismatch",
		body: "Update Cline on this phone and the connected computer before trying again.",
		retryable: false,
	},
	unknown: {
		headline: "Couldn't start the session",
		body: "Something went wrong reaching Cline. Retry, or choose another session.",
		retryable: true,
	},
};

/** Structural view of the error shapes the connection layer can surface. */
interface ErrorLike {
	name?: unknown;
	message?: unknown;
	code?: unknown;
	status?: unknown;
	details?: { closeCode?: unknown; closeReason?: unknown };
}

function asErrorLike(error: unknown): ErrorLike {
	return typeof error === "object" && error !== null
		? (error as ErrorLike)
		: {};
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** Close codes a hub uses to say "policy/auth", not "network". */
const AUTH_CLOSE_CODES = new Set([1008, 3000, 4401, 4403]);
const AUTH_PATTERN = /unauthor|forbidden|invalid token|bad credential|401|403/i;

export function classifyConnectionError(error: unknown): ConnectionErrorKind {
	const e = asErrorLike(error);
	const name = text(e.name);
	const code = text(e.code);
	const message = text(e.message);
	if (
		name === "ExactSessionNotFoundError" ||
		name === "RemoteSessionNotFoundError" ||
		name === "RemoteSessionExpiredError"
	) {
		return "missing";
	}
	if (
		name === "GitHubIntegrationRequiredError" ||
		code === "github_not_connected"
	)
		return "github";
	if (name === "CloudSessionApiError" && (e.status === 404 || e.status === 410))
		return "missing";
	if (
		name === "SessionAttachError" &&
		/not found|unknown session/i.test(message)
	) {
		return "missing";
	}

	if (
		code === "incompatible_protocol" ||
		name === "IncompatibleProtocolError"
	) {
		return "protocol";
	}

	// The cloud REST gateway does report an HTTP status, so auth is real here.
	if (
		name === "CloudSessionApiError" &&
		(e.status === 401 || e.status === 403)
	) {
		return "refused";
	}

	if (code === "hub_connect_timeout") {
		return "timeout";
	}

	if (code === "hub_connection_closed") {
		const closeCode = e.details?.closeCode;
		if (typeof closeCode === "number" && AUTH_CLOSE_CODES.has(closeCode)) {
			return "refused";
		}
		if (AUTH_PATTERN.test(text(e.details?.closeReason))) {
			return "refused";
		}
		return "dropped";
	}

	if (code === "hub_connect_failed" || code === "hub_connection_not_open") {
		// See the module note: a 401 at upgrade is indistinguishable from a dead
		// port, so this stays `unreachable` rather than guessing at auth.
		return "unreachable";
	}

	if (AUTH_PATTERN.test(message) || /signed-in token/i.test(message)) {
		return "refused";
	}

	return "unknown";
}

/** Human copy + the demoted diagnostic for a connection failure. */
export function describeConnectionError(
	error: unknown,
	connectionKind: "local" | "cloud" = "local",
): ConnectionErrorPresentation {
	const kind = classifyConnectionError(error);
	const raw = errorDetail(asErrorLike(error).message);
	const presentation: ConnectionErrorPresentation = {
		kind,
		...COPY[kind],
		...(raw ? { detail: raw } : {}),
	};
	if (kind === "missing") presentation.action = "new-chat";
	if (kind === "github") presentation.action = "connect-github";
	if (connectionKind === "cloud" && kind === "unreachable") {
		presentation.body =
			"Cline Cloud could not connect to this workspace. Check your connection and try again.";
	}
	if (connectionKind === "cloud" && kind === "refused") {
		presentation.headline = "Cline Cloud access needs attention";
		presentation.body =
			"Check that you are signed in to the account that owns this workspace.";
		if (
			asErrorLike(error).status === 401 ||
			/not signed in|signed-in token/i.test(text(asErrorLike(error).message))
		) {
			presentation.headline = "Sign in to Cline Cloud";
			presentation.body =
				"Your sign-in has expired. Sign in again to resume this conversation.";
			presentation.action = "sign-in";
			presentation.retryable = false;
		}
	}
	return presentation;
}
