import { describe, expect, it } from "vitest";
import {
	formatClineCredits,
	formatCreditBalance,
	normalizeCreditBalance,
} from "./credits";

describe("credit balance formatting", () => {
	it("normalizes Cline micro-credit balances before display", () => {
		expect(formatCreditBalance(normalizeCreditBalance(500_000))).toBe("$0.50");
		expect(formatCreditBalance(normalizeCreditBalance(5_000_000))).toBe(
			"$5.00",
		);
	});

	it("formats raw balances through formatClineCredits", () => {
		expect(formatClineCredits(500_000)).toBe("$0.50");
		expect(formatClineCredits(Number.NaN)).toBe("$0.00");
	});
});
