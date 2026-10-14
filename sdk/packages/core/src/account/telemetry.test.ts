import { describe, expect, it, vi } from "vitest";
import {
	persistClineAccountTelemetryIdentity,
	resolveClineAccountTelemetryIdentity,
} from "./telemetry";
import type { ClineAccountUser } from "./types";

function createUser(
	overrides: Partial<ClineAccountUser> = {},
): ClineAccountUser {
	return {
		id: "user-1",
		email: "user@example.com",
		displayName: "User",
		photoUrl: "",
		createdAt: "",
		updatedAt: "",
		organizations: [],
		...overrides,
	};
}

describe("Cline account telemetry identity", () => {
	it("resolves the active organization", () => {
		const identity = resolveClineAccountTelemetryIdentity(
			createUser({
				organizations: [
					{
						active: true,
						memberId: "member-1",
						name: "Acme",
						organizationId: "org-1",
						roles: ["member"],
					},
				],
			}),
		);

		expect(identity).toEqual({
			id: "user-1",
			email: "user@example.com",
			provider: "cline",
			organizationId: "org-1",
			organizationName: "Acme",
			memberId: "member-1",
		});
	});

	it("persists organization context for detached runtimes", () => {
		const saveProviderSettings = vi.fn();
		const manager = {
			getProviderSettings: vi.fn(() => ({
				provider: "cline" as const,
				auth: { accountId: "user-1", accessToken: "secret" },
			})),
			saveProviderSettings,
		};
		const identity = resolveClineAccountTelemetryIdentity(
			createUser({
				organizations: [
					{
						active: true,
						memberId: "member-1",
						name: "Acme",
						organizationId: "org-1",
						roles: ["member"],
					},
				],
			}),
		);

		expect(persistClineAccountTelemetryIdentity(manager, identity)).toBe(true);
		expect(saveProviderSettings).toHaveBeenCalledWith(
			{
				provider: "cline",
				auth: {
					accountId: "user-1",
					accessToken: "secret",
					organizationId: "org-1",
					organizationName: "Acme",
					memberId: "member-1",
				},
			},
			{ setLastUsed: false },
		);
	});

	it("replaces stale persisted account identity after an account switch", () => {
		const saveProviderSettings = vi.fn();
		const manager = {
			getProviderSettings: vi.fn(() => ({
				provider: "cline" as const,
				auth: { accountId: "old-user", accessToken: "secret" },
			})),
			saveProviderSettings,
		};

		persistClineAccountTelemetryIdentity(manager, {
			id: "new-user",
			provider: "cline",
		});

		expect(saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				auth: expect.objectContaining({ accountId: "new-user" }),
			}),
			{ setLastUsed: false },
		);
	});
});
