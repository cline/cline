import { getClineClientIdentity, setClineClientIdentity } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { buildClineClientHeaders } from "./cline-client-headers";

afterEach(() => {
	setClineClientIdentity(undefined);
});

describe("buildClineClientHeaders", () => {
	it("falls back to the SDK client type when no identity is registered", () => {
		expect(getClineClientIdentity()).toBeUndefined();
		expect(buildClineClientHeaders()).toEqual({
			"HTTP-Referer": "https://cline.bot",
			"X-Title": "Cline",
			"X-IS-MULTIROOT": "false",
			"User-Agent": "Cline/unknown",
			"X-CLIENT-TYPE": "cline-sdk",
			"X-CLIENT-VERSION": "unknown",
			"X-PLATFORM": "cline-sdk",
			"X-PLATFORM-VERSION": "unknown",
		});
	});

	it("stamps the registered client identity", () => {
		setClineClientIdentity({
			name: "VSCode Extension",
			version: "3.40.0",
			platform: "Visual Studio Code",
			platformVersion: "1.100.0",
		});

		expect(buildClineClientHeaders()).toMatchObject({
			"User-Agent": "Cline/3.40.0",
			"X-CLIENT-TYPE": "VSCode Extension",
			"X-CLIENT-VERSION": "3.40.0",
			"X-PLATFORM": "Visual Studio Code",
			"X-PLATFORM-VERSION": "1.100.0",
		});
	});

	it("ignores blank identity fields and honors an explicit override", () => {
		setClineClientIdentity({ name: "  ", version: "9.9.9" });

		expect(buildClineClientHeaders()).toMatchObject({
			"X-CLIENT-TYPE": "cline-sdk",
			"X-CLIENT-VERSION": "9.9.9",
			"X-PLATFORM": "cline-sdk",
			"X-PLATFORM-VERSION": "9.9.9",
		});
		expect(
			buildClineClientHeaders({ name: "cline-cli", version: "1.2.3" }),
		).toMatchObject({
			"X-CLIENT-TYPE": "cline-cli",
			"X-CLIENT-VERSION": "1.2.3",
		});
	});
});
