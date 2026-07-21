import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeJwtPayload } from "./jwt";

function jwtWithPayload(payload: Record<string, unknown>): string {
	return `header.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.sig`;
}

describe("decodeJwtPayload", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("decodes base64url JSON payloads as UTF-8", () => {
		expect(
			decodeJwtPayload(jwtWithPayload({ sub: "account-1", name: "测试" })),
		).toEqual({
			sub: "account-1",
			name: "测试",
		});
	});

	it("falls back to Buffer when atob is unavailable", () => {
		vi.stubGlobal("atob", undefined);

		expect(decodeJwtPayload(jwtWithPayload({ sub: "account-1" }))).toEqual({
			sub: "account-1",
		});
	});

	it.each([
		undefined,
		"",
		"invalid",
		"header..sig",
	])("returns null for an invalid token (%s)", (token) => {
		expect(decodeJwtPayload(token)).toBeNull();
	});
});
