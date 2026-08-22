import { describe, expect, it } from "vitest";
import { ApprovalBroker, GatewayCallError } from "./runtime";

describe("ApprovalBroker cancellation", () => {
	it("removes a host request when its owning OAuth flow is cancelled", async () => {
		const broker = new ApprovalBroker();
		const controller = new AbortController();
		const pending = broker.request(
			"client.openExternalUrl",
			{},
			{ url: "https://auth.example/" },
			controller.signal,
		);
		expect(broker.pendingCount).toBe(1);

		controller.abort();

		await expect(pending).rejects.toBeInstanceOf(GatewayCallError);
		expect(broker.pendingCount).toBe(0);
	});
});
