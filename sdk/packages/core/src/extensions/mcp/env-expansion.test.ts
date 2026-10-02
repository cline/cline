// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${env:VAR} is the literal config syntax under test.
import { afterEach, describe, expect, it, vi } from "vitest";
import { expandMcpEnvRecord } from "./env-expansion";

describe("expandMcpEnvRecord", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("resolves a reference from the process environment", () => {
		vi.stubEnv("CLINE_TEST_TOKEN", "secret-value");
		expect(expandMcpEnvRecord({ TOKEN: "${env:CLINE_TEST_TOKEN}" })).toEqual({
			TOKEN: "secret-value",
		});
	});

	it("resolves a reference embedded in surrounding text", () => {
		vi.stubEnv("CLINE_TEST_TOKEN", "abc123");
		expect(
			expandMcpEnvRecord({ AUTH: "Bearer ${env:CLINE_TEST_TOKEN}" }),
		).toEqual({ AUTH: "Bearer abc123" });
	});

	it("resolves every reference in a single value", () => {
		vi.stubEnv("CLINE_TEST_HOST", "example.com");
		vi.stubEnv("CLINE_TEST_PORT", "8080");
		expect(
			expandMcpEnvRecord({
				ENDPOINT: "https://${env:CLINE_TEST_HOST}:${env:CLINE_TEST_PORT}/v1",
			}),
		).toEqual({ ENDPOINT: "https://example.com:8080/v1" });
	});

	it("expands each key independently", () => {
		vi.stubEnv("CLINE_TEST_ONE", "1");
		vi.stubEnv("CLINE_TEST_TWO", "2");
		expect(
			expandMcpEnvRecord({
				FIRST: "${env:CLINE_TEST_ONE}",
				SECOND: "${env:CLINE_TEST_TWO}",
				LITERAL: "unchanged",
			}),
		).toEqual({ FIRST: "1", SECOND: "2", LITERAL: "unchanged" });
	});

	it("trims whitespace inside the reference", () => {
		vi.stubEnv("CLINE_TEST_TOKEN", "trimmed");
		expect(expandMcpEnvRecord({ TOKEN: "${env: CLINE_TEST_TOKEN }" })).toEqual({
			TOKEN: "trimmed",
		});
	});

	it("preserves a variable explicitly set to an empty string", () => {
		vi.stubEnv("CLINE_TEST_EMPTY", "");
		expect(expandMcpEnvRecord({ TOKEN: "${env:CLINE_TEST_EMPTY}" })).toEqual({
			TOKEN: "",
		});
	});

	it("leaves an unset reference literal", () => {
		vi.stubEnv("CLINE_TEST_MISSING", undefined);
		expect(expandMcpEnvRecord({ TOKEN: "${env:CLINE_TEST_MISSING}" })).toEqual({
			TOKEN: "${env:CLINE_TEST_MISSING}",
		});
	});

	it("passes values without a reference through untouched", () => {
		expect(
			expandMcpEnvRecord({ PLAIN: "value", DOLLAR: "$NOT_A_REFERENCE" }),
		).toEqual({ PLAIN: "value", DOLLAR: "$NOT_A_REFERENCE" });
	});

	it("returns an empty record unchanged", () => {
		expect(expandMcpEnvRecord({})).toEqual({});
	});
});
