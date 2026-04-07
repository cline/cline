import { describe, expect, it } from "vitest";
import { getProviderEnvKeys, resolveApiKeyForProvider } from "./auth";

describe("resolveApiKeyForProvider", () => {
	it("returns noop for lmstudio when no key is provided", () => {
		const apiKey = resolveApiKeyForProvider("lmstudio", undefined, {});
		expect(apiKey).toBe("noop");
	});

	it("prefers explicit api keys over provider defaults", () => {
		const apiKey = resolveApiKeyForProvider("lmstudio", "real-key", {});
		expect(apiKey).toBe("real-key");
	});

	it("does not apply lmstudio fallback to zai", () => {
		const apiKey = resolveApiKeyForProvider("zai", undefined, {});
		expect(apiKey).toBeUndefined();
	});

	it("accepts VERCEL_API_KEY for vercel-ai-gateway", () => {
		expect(getProviderEnvKeys("vercel-ai-gateway")).toContain("VERCEL_API_KEY");

		const apiKey = resolveApiKeyForProvider("vercel-ai-gateway", undefined, {
			VERCEL_API_KEY: "vercel-key",
		});

		expect(apiKey).toBe("vercel-key");
	});
});
