import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRelayTicketVerifyAccount } from "./ticket-auth";

const now = 1_786_120_000;

function encoded(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function issueTicket(
	privateKey: KeyObject,
	overrides: Record<string, unknown> = {},
): string {
	const header = encoded({ alg: "EdDSA", typ: "relay-ticket+jwt" });
	const claims = encoded({
		iss: "cline-core-local",
		sub: "usr-local",
		aud: ["cline-relay-local"],
		machineId: "2AZK742JPN9634H9",
		role: "client",
		iat: now,
		nbf: now,
		exp: now + 60,
		jti: "ticket-1",
		...overrides,
	});
	const signature = sign(
		null,
		Buffer.from(`${header}.${claims}`),
		privateKey,
	).toString("base64url");
	return `${header}.${claims}.${signature}`;
}

describe("createRelayTicketVerifyAccount", () => {
	it("verifies scope and rejects a replay", async () => {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		const rawPublicKey = (
			publicKey.export({ format: "der", type: "spki" }) as Buffer
		)
			.subarray(-32)
			.toString("base64url");
		const verify = createRelayTicketVerifyAccount({
			publicKey: rawPublicKey,
			issuer: "cline-core-local",
			audience: "cline-relay-local",
			now: () => now + 1,
		});
		const token = issueTicket(privateKey);

		expect(verify({ role: "client", token, headers: {} })).toEqual({
			accountId: "usr-local",
			machineId: "2AZK742JPN9634H9",
		});
		expect(verify({ role: "client", token, headers: {} })).toBeUndefined();
	});

	it("rejects role, audience, expiry, signature, and overlong lifetime", async () => {
		const keys = generateKeyPairSync("ed25519");
		const attacker = generateKeyPairSync("ed25519");
		const rawPublicKey = (
			keys.publicKey.export({ format: "der", type: "spki" }) as Buffer
		)
			.subarray(-32)
			.toString("base64url");
		const verify = createRelayTicketVerifyAccount({
			publicKey: rawPublicKey,
			issuer: "cline-core-local",
			audience: "cline-relay-local",
			now: () => now + 20,
		});
		const cases = [
			issueTicket(keys.privateKey, { role: "host", jti: "wrong-role" }),
			issueTicket(keys.privateKey, { aud: "other", jti: "wrong-aud" }),
			issueTicket(keys.privateKey, { exp: now - 20, jti: "expired" }),
			issueTicket(attacker.privateKey, { jti: "attacker" }),
			issueTicket(keys.privateKey, { exp: now + 301, jti: "too-long" }),
		];
		for (const token of cases) {
			expect(verify({ role: "client", token, headers: {} })).toBeUndefined();
		}
	});

	it("rejects a non-canonical public key at construction", () => {
		expect(() =>
			createRelayTicketVerifyAccount({
				publicKey: "not-a-public-key",
				issuer: "core",
				audience: "relay",
			}),
		).toThrow(/public key/);
	});
});
