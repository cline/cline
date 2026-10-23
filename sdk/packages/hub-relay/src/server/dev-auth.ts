/**
 * Account verification for a DEVELOPMENT relay, and the policy for where such a
 * relay may listen.
 *
 * This is security-critical despite being a dev tool. A channel to a laptop's
 * hub is arbitrary tool execution on that laptop, so a permissive verifier is
 * not "convenient", it is a remote code execution path gated only by whether the
 * port is reachable. Hence:
 *
 * - every account needs PROOF, derived from the shared dev secret. There is no
 *   "claim an account id and be believed" mode.
 * - binding anything other than loopback needs an explicit opt-in AND a strong,
 *   explicitly supplied token.
 *
 * It lives in the package rather than in `apps/mobile/scripts` so it is covered
 * by tests instead of by a script nobody runs in CI.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { RelayAccount, VerifyAccount } from "./server";

/** Prefix of a per-account dev token: `dev:<accountId>:<proof>`. */
export const DEV_ACCOUNT_TOKEN_PREFIX = "dev:";

/** Token below this length is not acceptable off loopback. */
export const DEV_MIN_REMOTE_TOKEN_LENGTH = 24;

const PROOF_LENGTH = 32;

/**
 * Proof that the holder knows the shared dev secret AND is asking for this
 * specific account, so one derived token cannot be replayed for another account.
 */
export function deriveDevAccountToken(
	sharedToken: string,
	accountId: string,
): string {
	const proof = createHmac("sha256", sharedToken)
		.update(`relay-dev-account:${accountId}`)
		.digest("hex")
		.slice(0, PROOF_LENGTH);
	return `${DEV_ACCOUNT_TOKEN_PREFIX}${accountId}:${proof}`;
}

function constantTimeEquals(left: string, right: string): boolean {
	const leftBytes = Buffer.from(left, "utf8");
	const rightBytes = Buffer.from(right, "utf8");
	if (leftBytes.length !== rightBytes.length) {
		return false;
	}
	return timingSafeEqual(leftBytes, rightBytes);
}

export interface CreateDevVerifyAccountOptions {
	/** The shared secret the relay prints on startup. */
	sharedToken: string;
	/** Account the shared token itself resolves to. */
	defaultAccountId: string;
}

/**
 * A dev `verifyAccount`. Accepts exactly two things: the shared token, and a
 * `dev:<accountId>:<proof>` token derived from it by
 * {@link deriveDevAccountToken}. Everything else is a 401, including a bare
 * `dev:<accountId>`.
 */
export function createDevVerifyAccount(
	options: CreateDevVerifyAccountOptions,
): VerifyAccount {
	return ({ token }): RelayAccount | undefined => {
		const candidate = token?.trim();
		if (!candidate) {
			return undefined;
		}
		if (constantTimeEquals(candidate, options.sharedToken)) {
			return { accountId: options.defaultAccountId };
		}
		if (!candidate.startsWith(DEV_ACCOUNT_TOKEN_PREFIX)) {
			return undefined;
		}
		const rest = candidate.slice(DEV_ACCOUNT_TOKEN_PREFIX.length);
		const separator = rest.lastIndexOf(":");
		if (separator <= 0) {
			// `dev:acct` with no proof: the whole point is that this is NOT enough.
			return undefined;
		}
		const accountId = rest.slice(0, separator);
		const proof = rest.slice(separator + 1);
		if (!accountId || !proof) {
			return undefined;
		}
		const expected = deriveDevAccountToken(options.sharedToken, accountId);
		return constantTimeEquals(candidate, expected) ? { accountId } : undefined;
	};
}

const LOOPBACK_HOSTS = new Set([
	"127.0.0.1",
	"::1",
	"localhost",
	"::ffff:127.0.0.1",
]);

export function isLoopbackHost(host: string): boolean {
	return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

export interface DevRelayBindRequest {
	host: string;
	sharedToken: string;
	/** `DEV_RELAY_ALLOW_REMOTE=1`. */
	allowRemote: boolean;
	/** Whether the token came from the environment rather than the default. */
	tokenWasProvided: boolean;
}

/**
 * Throws unless this bind is acceptable. Loopback is always fine; anything else
 * needs the opt-in AND a strong, explicitly supplied token, because binding
 * `0.0.0.0` with the published default token offers hub access to the network.
 */
export function assertDevRelayBindAllowed(request: DevRelayBindRequest): {
	warning?: string;
} {
	if (isLoopbackHost(request.host)) {
		return {};
	}
	if (!request.allowRemote) {
		throw new Error(
			`refusing to bind ${request.host}: a dev relay reachable off this machine is a remote path to your hub. Set DEV_RELAY_ALLOW_REMOTE=1 and DEV_RELAY_TOKEN=<${DEV_MIN_REMOTE_TOKEN_LENGTH}+ random characters> if you really mean it.`,
		);
	}
	if (
		!request.tokenWasProvided ||
		request.sharedToken.length < DEV_MIN_REMOTE_TOKEN_LENGTH
	) {
		throw new Error(
			`refusing to bind ${request.host} with a default or weak token: set DEV_RELAY_TOKEN to at least ${DEV_MIN_REMOTE_TOKEN_LENGTH} random characters.`,
		);
	}
	return {
		warning: `this dev relay is reachable from outside this machine (${request.host}). Anyone holding DEV_RELAY_TOKEN can run tools on this laptop through the bridged hub.`,
	};
}
