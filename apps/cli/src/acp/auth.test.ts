import { describe, expect, it } from "vitest";
import { ACP_AUTH_METHODS, isAcpAuthMethodId } from "./auth-methods";

describe("ACP authentication methods", () => {
	it("advertises and accepts ClinePass", () => {
		expect(ACP_AUTH_METHODS).toContainEqual({
			id: "cline-pass",
			name: "Sign in with ClinePass",
		});
		expect(isAcpAuthMethodId("cline-pass")).toBe(true);
	});
});
