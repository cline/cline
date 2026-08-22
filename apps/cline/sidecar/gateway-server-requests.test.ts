import { SERVER_REQUEST_METHODS } from "@cline/shared/gateway";
import { describe, expect, it, vi } from "vitest";
import { handleImmediateGatewayServerRequest } from "./gateway-server-requests";

function context() {
	return {
		client: {
			hello: { clientId: "client_desktop" },
		},
		workspaceRoot: "/workspace",
		workspaceRootLocked: true,
	} as never;
}

function request(
	url: string,
	targetClientId = "client_desktop",
): Parameters<typeof handleImmediateGatewayServerRequest>[1] {
	return {
		version: 1,
		id: "srq_1",
		method: SERVER_REQUEST_METHODS.openExternalUrl,
		scope: {},
		params: { url, targetClientId },
	};
}

describe("desktop Gateway server requests", () => {
	it("opens an addressed http(s) OAuth URL through the safe host command", async () => {
		const host = vi.fn(async () => ({
			handled: true as const,
			result: { opened: true },
		}));

		expect(
			await handleImmediateGatewayServerRequest(
				context(),
				request("https://auth.example/device?code=ABC"),
				host,
			),
		).toEqual({ handled: true, result: { opened: true } });
		expect(host).toHaveBeenCalledWith(context(), "open_external_url", {
			url: "https://auth.example/device?code=ABC",
		});
	});

	it("rejects non-web, credential-bearing, and misaddressed URLs before launching", async () => {
		const host = vi.fn(async () => ({
			handled: true as const,
			result: { opened: true },
		}));

		await expect(
			handleImmediateGatewayServerRequest(
				context(),
				request("file:///tmp/auth"),
				host,
			),
		).rejects.toThrow("http or https");
		await expect(
			handleImmediateGatewayServerRequest(
				context(),
				request("https://user:password@auth.example/"),
				host,
			),
		).rejects.toThrow("cannot contain credentials");
		await expect(
			handleImmediateGatewayServerRequest(
				context(),
				request("https://auth.example/", "another-client"),
				host,
			),
		).rejects.toThrow("not addressed to this desktop client");
		expect(host).not.toHaveBeenCalled();
	});

	it("leaves UI approval and question requests to the existing queue", async () => {
		expect(
			await handleImmediateGatewayServerRequest(context(), {
				version: 1,
				id: "srq_2",
				method: SERVER_REQUEST_METHODS.question,
				scope: {},
				params: { question: "Continue?" },
			}),
		).toEqual({ handled: false });
	});
});
