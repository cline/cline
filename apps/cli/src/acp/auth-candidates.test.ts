import { describe, expect, it } from "vitest";
import { resolveAcpAuthCandidates } from "./auth";

describe("resolveAcpAuthCandidates", () => {
	it("falls back to the declaration order when nothing is known", () => {
		expect(resolveAcpAuthCandidates({})).toEqual([
			"cline",
			"cline-pass",
			"openai-codex",
		]);
	});

	it("prefers the provider an ACP host pins through CLINE_PROVIDER", () => {
		expect(
			resolveAcpAuthCandidates({ envProvider: "cline-pass" }).slice(0, 1),
		).toEqual(["cline-pass"]);
	});

	it("prefers the provider used last, so ClinePass users keep their key", () => {
		const candidates = resolveAcpAuthCandidates({
			lastUsedProvider: "cline-pass",
		});

		expect(candidates[0]).toBe("cline-pass");
		// The remaining providers stay available as fallbacks.
		expect(candidates).toContain("cline");
		expect(candidates).toContain("openai-codex");
	});

	it("lets CLINE_PROVIDER win over the last used provider", () => {
		expect(
			resolveAcpAuthCandidates({
				envProvider: "cline",
				lastUsedProvider: "cline-pass",
			}).slice(0, 2),
		).toEqual(["cline", "cline-pass"]);
	});

	it("drops values that are not ACP auth methods and de-duplicates", () => {
		const candidates = resolveAcpAuthCandidates({
			envProvider: "openrouter",
			lastUsedProvider: "cline-pass",
		});

		expect(candidates).not.toContain("openrouter");
		expect(new Set(candidates).size).toBe(candidates.length);
	});
});
