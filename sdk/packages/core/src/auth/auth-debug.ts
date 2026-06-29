/**
 * Early SDK logger for components that operate before/outside of `ClineCore`
 * sessions.
 *
 * `ClineCore.create({ logger })` receives a `BasicLogger` but it is only
 * threaded to session-scoped components. Several components —
 * `ProviderSettingsManager`, `RuntimeOAuthTokenManager`, and the Cline auth
 * functions in `cline.ts` — are constructed or called before `ClineCore`
 * exists or outside a session lifecycle.
 * This module-level logger bridges that gap: hosts call `setSdkLogger()` once
 * at startup and every early component picks it up without threading loggers
 * through every constructor.
 *
 * When no logger is registered, every call is a no-op.
 *
 * Secrets are never logged in cleartext; {@link hashSecret} produces an
 * 8-hex-digit fingerprint that is stable for the same value but irreversible.
 */

import { createHash } from "node:crypto";
import type { BasicLogger } from "@cline/shared";

let earlyLogger: BasicLogger | undefined;

/**
 * Register the logger used by {@link sdkDebug}. Pass `undefined` to disable.
 */
export function setSdkLogger(logger: BasicLogger | undefined): void {
	earlyLogger = logger;
}

/** @internal Returns the currently registered early logger (for testing). */
export function getSdkLogger(): BasicLogger | undefined {
	return earlyLogger;
}

/**
 * Short, stable fingerprint of a secret for debug logging (8 hex digits of a
 * SHA-256 digest). The same input always yields the same hash, making it easy
 * to eyeball whether a token changed across log entries without leaking it.
 *
 * Returns `"unset"` for undefined/null/empty so absence is still visible.
 */
export function hashSecret(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		return "unset";
	}
	return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/**
 * Emit a debug-level SDK diagnostic event. Best-effort: swallows errors from
 * the underlying logger so logging never breaks auth/storage flows.
 */
export function sdkDebug(
	message: string,
	metadata?: Record<string, unknown>,
): void {
	try {
		earlyLogger?.debug(message, metadata);
	} catch {
		// Never let logging break the app.
	}
}
