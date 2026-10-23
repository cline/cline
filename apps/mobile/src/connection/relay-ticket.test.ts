import { describe, expect, it, vi } from "vitest";
import { RelayTicketError, requestRelayTicket } from "./relay-ticket";

describe("requestRelayTicket", () => {
	it("exchanges the account token for a scoped client ticket", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						success: true,
						data: { token: "signed-ticket", expiresAt: "2030-01-01T00:00:00Z" },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);

		await expect(
			requestRelayTicket({
				apiBaseUrl: "https://api.example",
				getAccessToken: async () => "jwt",
				machineId: "machine/one",
				role: "client",
				fetchImpl,
			}),
		).resolves.toBe("signed-ticket");
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://api.example/api/v1/machines/machine%2Fone/relay-ticket",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer workos:jwt",
				}),
				body: JSON.stringify({ role: "client" }),
			}),
		);
	});

	it("fails closed when core returns an invalid envelope", async () => {
		await expect(
			requestRelayTicket({
				apiBaseUrl: "https://api.example",
				getAccessToken: async () => "jwt",
				machineId: "machine-one",
				role: "client",
				fetchImpl: async () =>
					new Response(JSON.stringify({ success: true, data: {} }), {
						status: 200,
					}),
			}),
		).rejects.toBeInstanceOf(RelayTicketError);
	});
});
