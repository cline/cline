import { describe, expect, it, vi } from "vitest";
import { fromProtoStruct, fromProtoValue } from "../proto/serde.js";
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

describe("ClineGatewayRuntime.enterprise methods", () => {
	it("routes enterprise sync requests", async () => {
		const enterpriseSync = vi.fn(async (request) => {
			expect(request).toEqual({
				providerId: "workos",
				workspacePath: "/tmp/workspace",
				rootPath: "/tmp",
				projectId: "proj_123",
				workspaceId: "ws_123",
				organizationId: "org_123",
				useCachedBundle: true,
			});
			return {
				providerId: "workos",
				authenticated: true,
				hasCachedBundle: true,
				appliedConfigVersion: "v1",
				roles: ["admin"],
				hasTelemetryOverrides: true,
				rulesCount: 2,
				workflowsCount: 1,
				skillsCount: 1,
				claims: { subject: "user_123" },
				metadata: { source: "control-plane" },
			};
		});
		const runtime = new ClineGatewayRuntime(
			"127.0.0.1:0",
			createSessionBackend(),
			{ enterpriseSync },
		);

		const response = await runtime.enterpriseSync({
			providerId: "workos",
			workspacePath: "/tmp/workspace",
			rootPath: "/tmp",
			projectId: "proj_123",
			workspaceId: "ws_123",
			organizationId: "org_123",
			useCachedBundle: true,
			hasUseCachedBundle: true,
		} as never);

		expect(enterpriseSync).toHaveBeenCalledTimes(1);
		expect(response.providerId).toBe("workos");
		expect(response.rulesCount).toBe(2);
		expect(fromProtoStruct(response.claims)).toEqual({ subject: "user_123" });
		expect(fromProtoStruct(response.metadata)).toEqual({
			source: "control-plane",
		});
	});
});
