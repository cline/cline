import {
	createClientId,
	createGatewayId,
	createGatewayInstanceId,
} from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { type GatewayIdentityInfo, negotiateHello } from "./hello";

const gateway: GatewayIdentityInfo = {
	gatewayId: createGatewayId(),
	instanceId: createGatewayInstanceId(),
	catalogGeneration: 7,
};

describe("gateway.hello negotiation", () => {
	it("negotiates the shared protocol version and assigns a client ID", () => {
		const outcome = negotiateHello(
			{ protocolVersions: [1], client: { name: "cli", version: "1.0.0" } },
			gateway,
		);
		expect(outcome.ok).toBe(true);
		if (outcome.ok) {
			expect(outcome.result.protocolVersion).toBe(1);
			expect(outcome.result.gatewayId).toBe(gateway.gatewayId);
			expect(outcome.result.instanceId).toBe(gateway.instanceId);
			expect(outcome.result.catalogGeneration).toBe(7);
			expect(outcome.result.clientId).toMatch(/^cli_/);
			expect(outcome.result.capabilities.length).toBeGreaterThan(0);
		}
	});

	it("keeps a resuming client's registered identity", () => {
		const clientId = createClientId();
		const outcome = negotiateHello(
			{
				protocolVersions: [1],
				client: { name: "desktop", version: "2.0.0", clientId },
			},
			gateway,
		);
		expect(outcome.ok && outcome.result.clientId).toBe(clientId);
	});

	it("fails closed when no protocol version is shared", () => {
		const outcome = negotiateHello(
			{ protocolVersions: [99], client: { name: "future", version: "9.9.9" } },
			gateway,
		);
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.error.code).toBe("protocol_version_unsupported");
			expect(outcome.error.retryable).toBe(false);
		}
	});

	it("rejects malformed hello params", () => {
		const outcome = negotiateHello({ client: { name: "cli" } }, gateway);
		expect(!outcome.ok && outcome.error.code).toBe("invalid_request");
	});
});
