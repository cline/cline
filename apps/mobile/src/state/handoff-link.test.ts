/**
 * The handoff link is a *contract* with the CLI, so these tests pin the wire
 * format itself: which fields are required, how they are encoded, and — because
 * the link carries pairing material — which spellings are refused rather than
 * best-effort parsed.
 */

import { describe, expect, it } from "vitest";
import {
	base64UrlToBytes,
	decodeHandoffParams,
	decodeHandoffUrl,
	HANDOFF_KEY_BYTES,
	HandoffLinkError,
	type HandoffParams,
	isHandoffUrl,
	utf8ToString,
} from "./handoff-link";

const NOW = 1_700_000_000_000;
const EXPIRY = NOW + 120_000;

/** 32 zero bytes: 43 base64url characters with zeroed trailing bits. */
const KEY = "A".repeat(43);
const SECRET = `${"B".repeat(42)}A`;
const HUB_URL = "ws://192.168.1.20:4599/hub";

function b64url(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function params(
	overrides: Partial<Record<string, string>> = {},
): HandoffParams {
	const base: Record<string, string> = {
		v: "1",
		i: "offer-1",
		k: KEY,
		s: SECRET,
		u: b64url(HUB_URL),
		n: "MacBook Pro",
		e: String(EXPIRY),
	};
	const merged: HandoffParams = { ...base };
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) {
			delete merged[key];
		} else {
			merged[key] = value;
		}
	}
	return merged;
}

function handoffUrl(overrides: Partial<Record<string, string>> = {}): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params(overrides))) {
		if (typeof value === "string") {
			query.set(key, value);
		}
	}
	return `clinecode://handoff?${query.toString()}`;
}

describe("handoff link decoding", () => {
	it("decodes every field of a v1 link", () => {
		const link = decodeHandoffParams(params({ sid: "hub-session-7" }), {
			now: NOW,
		});
		expect(link.version).toBe(1);
		expect(link.hubPublicKey).toHaveLength(HANDOFF_KEY_BYTES);
		expect(link.offerId).toBe("offer-1");
		expect(link.oneTimeSecret).toHaveLength(32);
		expect(link.oneTimeSecretText).toBe(SECRET);
		expect(link.url).toBe(HUB_URL);
		expect(link.machineName).toBe("MacBook Pro");
		expect(link.expiresAt).toBe(EXPIRY);
		expect(link.hubSessionId).toBe("hub-session-7");
	});

	it("treats sid as optional", () => {
		expect(decodeHandoffParams(params(), { now: NOW }).hubSessionId).toBe(
			undefined,
		);
	});

	it("decodes a whole clinecode:// url, query intact", () => {
		const link = decodeHandoffUrl(handoffUrl({ sid: "s1" }), { now: NOW });
		expect(link.url).toBe(HUB_URL);
		expect(link.machineName).toBe("MacBook Pro");
		expect(link.hubSessionId).toBe("s1");
	});

	it("accepts the router-relative forms of the same link", () => {
		const query = handoffUrl().split("?")[1] as string;
		for (const candidate of [
			`clinecode:///handoff?${query}`,
			`/handoff?${query}`,
			`handoff?${query}`,
		]) {
			expect(decodeHandoffUrl(candidate, { now: NOW }).url).toBe(HUB_URL);
		}
	});

	it("refuses a link from another scheme or another path", () => {
		for (const candidate of [
			`https://evil.example/handoff?${handoffUrl().split("?")[1]}`,
			`otherapp://handoff?${handoffUrl().split("?")[1]}`,
			`clinecode://pair?${handoffUrl().split("?")[1]}`,
		]) {
			expect(() => decodeHandoffUrl(candidate, { now: NOW })).toThrow(
				/not a Cline handoff link/,
			);
		}
	});

	it("recognises a handoff url without trusting its fields", () => {
		expect(isHandoffUrl("clinecode://handoff?v=1")).toBe(true);
		expect(isHandoffUrl("clinecode://handoff")).toBe(true);
		expect(isHandoffUrl("clinecode://settings")).toBe(false);
		expect(isHandoffUrl("https://app.cline.bot/handoff")).toBe(false);
	});
});

describe("handoff link validation", () => {
	it("rejects an expired link with the instruction to run /handoff again", () => {
		const error = catchError(() =>
			decodeHandoffParams(params({ e: String(NOW - 1) }), { now: NOW }),
		);
		expect(error.reason).toBe("expired");
		expect(error.message).toContain("expired");
		expect(error.message).toContain("/handoff");
		// A person-readable sentence, not a dump.
		expect(error.message).not.toContain("Error");
	});

	it("treats the expiry instant itself as expired", () => {
		expect(
			catchError(() =>
				decodeHandoffParams(params({ e: String(NOW) }), { now: NOW }),
			).reason,
		).toBe("expired");
	});

	it("refuses an unknown protocol version instead of guessing", () => {
		for (const version of ["2", "0", "11"]) {
			const error = catchError(() =>
				decodeHandoffParams(params({ v: version }), { now: NOW }),
			);
			expect(error.reason).toBe("unsupported_version");
			expect(error.message).toContain(version);
		}
	});

	it("reports a missing required field as an incomplete link", () => {
		for (const field of ["i", "k", "s", "u", "n", "e"]) {
			const error = catchError(() =>
				decodeHandoffParams(params({ [field]: undefined }), { now: NOW }),
			);
			expect(error.reason).toBe("missing_fields");
			expect(error.message).toContain("incomplete");
		}
	});

	it("treats an empty value as missing", () => {
		expect(
			catchError(() => decodeHandoffParams(params({ n: "   " }), { now: NOW }))
				.reason,
		).toBe("missing_fields");
	});

	it("names the missing version separately from an unsupported one", () => {
		expect(
			catchError(() =>
				decodeHandoffParams(params({ v: undefined }), { now: NOW }),
			).reason,
		).toBe("missing_fields");
	});

	it("rejects a key of the wrong length", () => {
		expect(
			catchError(() => decodeHandoffParams(params({ k: "AAAA" }), { now: NOW }))
				.reason,
		).toBe("malformed_key");
	});

	it("rejects a durable hub token in place of the fixed-width pairing secret", () => {
		const hubToken = "a".repeat(64);
		expect(
			catchError(() =>
				decodeHandoffParams(params({ s: hubToken }), { now: NOW }),
			).reason,
		).toBe("malformed_secret");
	});

	it("rejects a link carrying no credential", () => {
		expect(
			catchError(() => decodeHandoffParams(params({ s: "" }), { now: NOW }))
				.reason,
		).toBe("missing_fields");
	});

	it("rejects standard base64 spellings of the key (base64url only)", () => {
		// `+` and `/` would give one key several spellings.
		const standard = `${"A".repeat(41)}+/`;
		expect(
			catchError(() =>
				decodeHandoffParams(params({ k: standard }), { now: NOW }),
			).reason,
		).toBe("malformed_key");
		expect(
			catchError(() =>
				decodeHandoffParams(params({ k: `${KEY}==` }), { now: NOW }),
			).reason,
		).toBe("malformed_key");
	});

	it("rejects a non-canonical key whose trailing bits are set", () => {
		// 43 chars = 258 bits; the last two must be zero. `B` sets them.
		expect(
			catchError(() =>
				decodeHandoffParams(params({ k: `${"A".repeat(42)}B` }), { now: NOW }),
			).reason,
		).toBe("malformed_key");
	});

	it("rejects a url that is not a hub address", () => {
		for (const url of [
			b64url("file:///etc/passwd"),
			b64url("javascript:alert(1)"),
			b64url("not a url"),
			"!!!not-base64!!!",
		]) {
			expect(
				catchError(() => decodeHandoffParams(params({ u: url }), { now: NOW }))
					.reason,
			).toBe("malformed_url");
		}
	});

	it("accepts the http(s) hub spelling, which the connection layer rewrites", () => {
		for (const url of ["http://127.0.0.1:4599/hub", "wss://hub.example/ws"]) {
			expect(
				decodeHandoffParams(params({ u: b64url(url) }), { now: NOW }).url,
			).toBe(url);
		}
	});

	it("rejects a malformed expiry", () => {
		for (const expiry of ["soon", "-1", "1.5", "1e12"]) {
			expect(
				catchError(() =>
					decodeHandoffParams(params({ e: expiry }), { now: NOW }),
				).reason,
			).toBe("malformed_expiry");
		}
	});

	it("strips control characters from the machine name and bounds it", () => {
		const link = decodeHandoffParams(
			params({ n: `Mac\u0000Book\nPro${"!".repeat(200)}` }),
			{ now: NOW },
		);
		expect(link.machineName.startsWith("MacBookPro")).toBe(true);
		expect(link.machineName.length).toBeLessThanOrEqual(64);
	});

	it("rejects a name that is only control characters", () => {
		expect(
			catchError(() =>
				decodeHandoffParams(params({ n: "\u0001\u0002" }), { now: NOW }),
			).reason,
		).toBe("malformed_name");
	});

	it("uses the first value when a param is repeated", () => {
		const link = decodeHandoffParams(
			{ ...params(), n: ["MacBook Pro", "Attacker"] },
			{ now: NOW },
		);
		expect(link.machineName).toBe("MacBook Pro");
	});
});

describe("byte helpers", () => {
	it("round-trips utf-8 through base64url", () => {
		for (const value of [
			"ws://hub/ws",
			"wss://naïve.example/hub",
			"ws://[::1]:1/",
		]) {
			expect(utf8ToString(base64UrlToBytes(b64url(value)))).toBe(value);
		}
	});

	it("refuses a 4n+1 base64url group", () => {
		expect(() => base64UrlToBytes("A")).toThrow(/Invalid base64url length/);
	});
});

function catchError(run: () => unknown): HandoffLinkError {
	try {
		run();
	} catch (error) {
		if (error instanceof HandoffLinkError) {
			return error;
		}
		throw error;
	}
	throw new Error("Expected a HandoffLinkError");
}
