import { describe, expect, it, vi } from "vitest";
import { fromProtoValue } from "../proto/serde.js";
import type { RpcSessionBackend } from "../types.js";
import { ClineGatewayRuntime } from "./runtime.js";

function createSessionBackend(): RpcSessionBackend {
	return {
		init: vi.fn(),
		upsertSession: vi.fn(),
		getSession: vi.fn(),
		listSessions: vi.fn(() => []),
		updateSession: vi.fn(() => ({ updated: false, statusLock: 0 })),
		deleteSession: vi.fn(() => false),
		deleteSessionsByParent: vi.fn(),
		enqueueSpawnRequest: vi.fn(),
		claimSpawnRequest: vi.fn(() => undefined),
	};
}

describe("ClineGatewayRuntime.runProviderAction", () => {
	it("routes fetchFeaturebaseToken cline account actions", async () => {
		const runProviderAction = vi.fn(async (request) => {
			expect(request).toEqual({
				action: "clineAccount",
				operation: "fetchFeaturebaseToken",
			});
			return {
				result: { featurebaseJwt: "server-runtime-jwt" },
			};
		});
		const runtime = new ClineGatewayRuntime(
			"127.0.0.1:0",
			createSessionBackend(),
			{ runProviderAction },
		);

		const response = await runtime.runProviderAction({
			request: {
				clineAccount: {
					operation: "fetchFeaturebaseToken",
					userId: "",
					organizationId: "",
					memberId: "",
					clearOrganizationId: false,
				},
			},
		} as never);

		expect(runProviderAction).toHaveBeenCalledTimes(1);
		expect(fromProtoValue(response.result)).toEqual({
			featurebaseJwt: "server-runtime-jwt",
		});
	});
});
