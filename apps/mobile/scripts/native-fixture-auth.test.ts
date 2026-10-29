import {
	completeClineDeviceAuth,
	getValidClineCredentials,
} from "@cline/core/auth/cline-device";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureAuthResponse } from "../e2e/native-fixture/auth";
import { FixtureFaults } from "../e2e/native-fixture/faults";

const base = "https://fixture.invalid";
const options = { apiBaseUrl: base, provider: "cline" };
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
function harness() {
	const faults = new FixtureFaults();
	const calls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const path = new URL(String(input)).pathname;
			calls.push(path);
			if (path === "/user_management/authenticate")
				return Response.json({
					access_token: "fixture-workos",
					refresh_token: "fixture-workos-refresh",
					token_type: "Bearer",
				});
			return (
				fixtureAuthResponse(path, faults, "synthetic-token") ??
				new Response(null, { status: 404 })
			);
		}),
	);
	const register = () =>
		completeClineDeviceAuth({
			...options,
			deviceCode: "fixture-device",
			expiresInSeconds: 900,
			pollIntervalSeconds: 1,
			workOsBaseUrl: base,
			workOsClientId: "client_fixture",
		});
	return { faults, calls, register };
}

describe("opt-in fixture credential-expiry contract", () => {
	it("preserves normal24h credentials and existing token/user metadata", async () => {
		const h = harness();
		const before = Date.now();
		const credentials = await h.register();
		expect(credentials.expires - before).toBeGreaterThanOrEqual(86400000);
		expect(credentials.expires - Date.now()).toBeLessThanOrEqual(86400000);
		expect(credentials.access).toBe("synthetic-token");
		expect(credentials.refresh).toBe("fixture-refresh");
		expect(credentials.accountId).toBe("fixture-account");
		expect(credentials.email).toBe("simulator@example.invalid");
		expect(await getValidClineCredentials(credentials, options)).toBe(
			credentials,
		);
		expect(h.calls).toEqual([
			"/user_management/authenticate",
			"/api/v1/auth/register",
		]);
	});
	it("uses the real five-minute SDK buffer:7m remains valid, then refreshes after2m and returns null only for invalid grant", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
		const h = harness();
		h.faults.set("global", "auth-short-credentials", 1);
		const credentials = await h.register();
		expect(credentials.expires - Date.now()).toBe(420000);
		expect(await getValidClineCredentials(credentials, options)).toBe(
			credentials,
		);
		expect(h.calls.filter((path) => path.endsWith("refresh"))).toHaveLength(0);
		vi.setSystemTime(Date.now() + 120001);
		const refreshed = await getValidClineCredentials(credentials, options);
		expect(refreshed?.expires).toBe(Date.now() + 420000);
		expect(h.calls.filter((path) => path.endsWith("refresh"))).toHaveLength(1);
		h.faults.set("global", "auth-refresh-invalid", 1);
		vi.setSystemTime(Date.now() + 120001);
		expect(await getValidClineCredentials(refreshed, options)).toBeNull();
		expect(h.calls.filter((path) => path.endsWith("refresh"))).toHaveLength(2);
	});
	it("rejects only refresh while registration/device authentication still succeeds, and clearing restores refresh", async () => {
		const h = harness();
		h.faults.set("global", "auth-short-credentials", 1);
		h.faults.set("global", "auth-refresh-invalid", 1);
		const credentials = await h.register();
		const response = fixtureAuthResponse(
			"/api/v1/auth/refresh",
			h.faults,
			"synthetic-token",
		)!;
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: "invalid_grant" });
		expect(
			await getValidClineCredentials(credentials, options, {
				forceRefresh: true,
			}),
		).toBeNull();
		h.faults.set("global", "auth-short-credentials", 0);
		h.faults.set("global", "auth-refresh-invalid", 0);
		const refreshed = await getValidClineCredentials(credentials, options, {
			forceRefresh: true,
		});
		if (!refreshed) throw new Error("Expected refresh credentials");
		expect(refreshed.expires - Date.now()).toBeGreaterThan(86399000);
		expect(
			fixtureAuthResponse(
				"/user_management/authenticate",
				h.faults,
				"synthetic-token",
			),
		).toBeUndefined();
	});
	it.each([
		"auth-short-credentials",
		"auth-refresh-invalid",
	])("restricts %s to explicit global boolean controls", (fault) => {
		const faults = new FixtureFaults();
		expect(() => faults.set("workspace-a", fault, 1)).toThrow(/global/);
		expect(() => faults.set("global", fault, 2)).toThrow(/value/);
		faults.set("global", fault, 1);
		faults.clear("global");
		expect(faults.get("global", fault)).toBe(0);
	});
});
