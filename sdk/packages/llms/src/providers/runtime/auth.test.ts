import { describe, expect, it } from "vitest";
import { resolveApiKeyForProvider } from "./auth";

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
});
