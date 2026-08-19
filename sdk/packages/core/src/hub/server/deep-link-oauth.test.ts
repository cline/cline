import { describe, expect, it } from "vitest";
import { DeepLinkOAuthTransactionStore } from "./deep-link-oauth";

describe("DeepLinkOAuthTransactionStore", () => {
	it("binds a callback to its provider and exact redirect URI", () => {
		const store = new DeepLinkOAuthTransactionStore(
			() => 1_000,
			() => "state-1",
		);
		const { transaction } = store.begin("cline");
		expect(transaction.redirectUri).toBe("cline://auth?state=state-1");
		expect(
			store.consume(
				new URL("cline://auth?state=state-1&code=code&provider=cline"),
			),
		).toEqual(transaction);
	});

	it("rejects callbacks without a pending transaction and replay attempts", () => {
		const store = new DeepLinkOAuthTransactionStore(
			() => 1_000,
			() => "state-1",
		);
		store.begin("cline");
		const callback = new URL("cline://auth?state=state-1&code=code");
		store.consume(callback);
		expect(() => store.consume(callback)).toThrow(
			"does not match a pending login",
		);
		expect(() => store.consume(new URL("cline://auth?code=code"))).toThrow(
			"missing transaction state",
		);
	});

	it("rejects expired callbacks", () => {
		let now = 1_000;
		const store = new DeepLinkOAuthTransactionStore(
			() => now,
			() => "state-1",
		);
		store.begin("cline");
		now += 10 * 60 * 1000;
		expect(() =>
			store.consume(new URL("cline://auth?state=state-1&provider=cline")),
		).toThrow("expired");
	});
});
