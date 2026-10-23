/**
 * The dev relay's `verifyAccount` is the only thing between a port on a laptop
 * and a channel to that laptop's hub — which is arbitrary tool execution. It
 * lives here, next to the server it guards, so it is testable rather than
 * script-local.
 */

import { describe, expect, it } from "vitest";
import {
	assertDevRelayBindAllowed,
	createDevVerifyAccount,
	deriveDevAccountToken,
} from "./dev-auth";

const SHARED = "a-shared-dev-token-of-decent-length";

const verify = createDevVerifyAccount({
	sharedToken: SHARED,
	defaultAccountId: "dev-account",
});

function ask(token: string | undefined): { accountId: string } | undefined {
	// The dev verifier is synchronous by construction, so a test can assert on it
	// directly rather than awaiting.
	return verify({ role: "host", token, headers: {} }) as
		| { accountId: string }
		| undefined;
}

describe("dev relay account verification", () => {
	it("accepts the shared token as the default dev account", () => {
		expect(ask(SHARED)).toEqual({ accountId: "dev-account" });
		expect(ask(` ${SHARED} `)).toEqual({ accountId: "dev-account" });
	});

	it("refuses an unproven dev:<accountId> impersonation", () => {
		// This is the hole: `dev:dev-account` used to be granted with no proof at
		// all, and `dev-account` is the account the auto-bridged laptop hub
		// registers under, so anyone reaching the port got a channel to the hub.
		expect(ask("dev:dev-account")).toBeUndefined();
		expect(ask("dev:acct_anything")).toBeUndefined();
		expect(ask("dev:")).toBeUndefined();
		expect(ask("dev:dev-account:")).toBeUndefined();
		expect(ask("dev:dev-account:deadbeef")).toBeUndefined();
	});

	it("accepts a per-account token derived from the shared secret", () => {
		const token = deriveDevAccountToken(SHARED, "acct_second");
		expect(token.startsWith("dev:acct_second:")).toBe(true);
		expect(ask(token)).toEqual({ accountId: "acct_second" });
		// Derived under a different secret: refused.
		expect(ask(deriveDevAccountToken("some-other-secret", "acct_second"))).toBe(
			undefined,
		);
		// Proof is bound to the account it was minted for.
		const swapped = token.replace("acct_second", "acct_third");
		expect(ask(swapped)).toBeUndefined();
	});

	it("refuses missing, empty and unrelated tokens", () => {
		expect(ask(undefined)).toBeUndefined();
		expect(ask("")).toBeUndefined();
		expect(ask("   ")).toBeUndefined();
		expect(ask("not-the-shared-token")).toBeUndefined();
		expect(ask(`${SHARED}x`)).toBeUndefined();
	});
});

describe("dev relay bind policy", () => {
	it("allows loopback with the default token", () => {
		for (const host of ["127.0.0.1", "::1", "localhost"]) {
			expect(() =>
				assertDevRelayBindAllowed({
					host,
					sharedToken: "cline-dev-relay-token",
					allowRemote: false,
					tokenWasProvided: false,
				}),
			).not.toThrow();
		}
	});

	it("refuses a non-loopback bind without an explicit opt-in", () => {
		expect(() =>
			assertDevRelayBindAllowed({
				host: "0.0.0.0",
				sharedToken: "a-very-long-and-explicitly-provided-token",
				allowRemote: false,
				tokenWasProvided: true,
			}),
		).toThrow(/DEV_RELAY_ALLOW_REMOTE/);
	});

	it("refuses a non-loopback bind with a weak or default token even when opted in", () => {
		expect(() =>
			assertDevRelayBindAllowed({
				host: "0.0.0.0",
				sharedToken: "cline-dev-relay-token",
				allowRemote: true,
				tokenWasProvided: false,
			}),
		).toThrow(/DEV_RELAY_TOKEN/);
		expect(() =>
			assertDevRelayBindAllowed({
				host: "192.168.1.10",
				sharedToken: "short",
				allowRemote: true,
				tokenWasProvided: true,
			}),
		).toThrow(/DEV_RELAY_TOKEN/);
	});

	it("allows a non-loopback bind only with an opt-in AND a strong token", () => {
		const result = assertDevRelayBindAllowed({
			host: "0.0.0.0",
			// Long enough to satisfy the strength check, and deliberately not
			// high-entropy: a realistic-looking token trips secret scanners.
			sharedToken: "FAKE-not-a-real-dev-relay-token-000",
			allowRemote: true,
			tokenWasProvided: true,
		});
		expect(result.warning).toMatch(/reachable/i);
	});
});
