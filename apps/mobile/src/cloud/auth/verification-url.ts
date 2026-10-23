/**
 * Scheme allowlist for the WorkOS device-flow verification URL.
 *
 * `verification_uri_complete` comes straight off a network response, and
 * `Linking.openURL` on iOS/Android happily follows ANY scheme — including
 * `cline://`, other apps' custom schemes, `javascript:` inside a webview or
 * `file:`. A hostile or merely malformed response must not be able to drive an
 * arbitrary deep link, so only a browser-bound URL is ever auto-opened; anything
 * else is shown to the user as copyable text instead.
 *
 * `http:` is allowed for loopback hosts only, so a locally hosted WorkOS stub
 * (the `local` Cline environment) still works during development.
 */

/** `https://host[...]` with no whitespace anywhere. */
const HTTPS_URL = /^https:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i;

/** `http://` restricted to loopback hosts, optional port. */
const LOOPBACK_HTTP_URL =
	/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#]\S*)?$/i;

/** True when `raw` is safe to hand to `Linking.openURL`. */
export function isAllowedVerificationUrl(
	raw: string | null | undefined,
): boolean {
	if (typeof raw !== "string") {
		return false;
	}
	const candidate = raw.trim();
	if (candidate.length === 0 || /\s/.test(candidate)) {
		return false;
	}
	return HTTPS_URL.test(candidate) || LOOPBACK_HTTP_URL.test(candidate);
}
