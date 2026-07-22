import { beforeEach, describe, expect, it, vi } from "vitest";
import { loginProviderWithOAuth } from "./provider-oauth";

const { invokeMock, subscribeMock, unsubscribeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	subscribeMock: vi.fn(),
	unsubscribeMock: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: invokeMock,
		subscribe: subscribeMock,
	},
}));

describe("loginProviderWithOAuth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("crypto", { randomUUID: () => "flow-1" });
		subscribeMock.mockReturnValue(unsubscribeMock);
	});

	it("forwards only the matching authorization request and unsubscribes", async () => {
		const onAuthorization = vi.fn();
		invokeMock.mockImplementation(
			async (_command: string, args: Record<string, unknown>) => {
				const handler = subscribeMock.mock.calls[0]?.[1] as (
					payload: unknown,
				) => void;
				handler({
					flowId: "another-flow",
					providerId: "cline",
					url: "https://ignored.example.com",
				});
				handler({
					flowId: args.flowId,
					providerId: "cline",
					url: "https://auth.example.com/authorize",
					instructions: "Continue sign-in",
				});
				return { provider: "cline", accessTokenPresent: true };
			},
		);

		await expect(
			loginProviderWithOAuth({ providerId: "cline", onAuthorization }),
		).resolves.toEqual({ provider: "cline", accessTokenPresent: true });

		expect(subscribeMock).toHaveBeenCalledWith(
			"oauth_authorization_requested",
			expect.any(Function),
		);
		expect(invokeMock).toHaveBeenCalledWith("run_provider_oauth_login", {
			provider: "cline",
			flowId: "flow-1",
		});
		expect(onAuthorization).toHaveBeenCalledOnce();
		expect(onAuthorization).toHaveBeenCalledWith({
			flowId: "flow-1",
			providerId: "cline",
			url: "https://auth.example.com/authorize",
			instructions: "Continue sign-in",
		});
		expect(unsubscribeMock).toHaveBeenCalledOnce();
	});

	it("unsubscribes when login fails", async () => {
		invokeMock.mockRejectedValue(new Error("login failed"));

		await expect(
			loginProviderWithOAuth({
				providerId: "cline",
				onAuthorization: vi.fn(),
			}),
		).rejects.toThrow("login failed");

		expect(unsubscribeMock).toHaveBeenCalledOnce();
	});
});
