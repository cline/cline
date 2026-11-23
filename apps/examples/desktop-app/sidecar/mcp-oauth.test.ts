import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	cancelMcpOAuthAuthorization,
	cancelMcpOAuthAuthorizationsForOwner,
	runMcpOAuthAuthorization,
} from "./mcp-oauth";
import type { SidecarContext } from "./types";

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@cline/core", async (original) => ({
	...(await original<typeof import("@cline/core")>()),
	createHubMcpApi: () => ({ authorize }),
}));
vi.mock("./context", () => ({ ensureSharedHubClient: async () => ({}) }));
beforeEach(() => {
	authorize.mockReset();
});
describe("Desktop MCP OAuth UI adapter", () => {
	it("forwards browser interaction without touching configuration", async () => {
		authorize.mockImplementation(async (name, options) => {
			await options.openUrl("https://example.test/auth");
			return { servers: [{ name }] };
		});
		const open = vi.fn().mockResolvedValue(undefined);
		expect(
			await runMcpOAuthAuthorization({} as SidecarContext, "remote", {}, open),
		).toEqual({ servers: [{ name: "remote" }] });
		expect(open).toHaveBeenCalledWith("https://example.test/auth");
	});
	it("cancels only UI interactions owned by the initiating webview", async () => {
		const owner = {},
			other = {};
		const signals: AbortSignal[] = [];
		authorize.mockImplementation(async (_name, options) => {
			signals.push(options.signal);
			return new Promise((resolve) =>
				options.signal.addEventListener("abort", () =>
					resolve({ servers: [] }),
				),
			);
		});
		const first = runMcpOAuthAuthorization(
			{} as SidecarContext,
			"remote",
			owner,
			vi.fn(),
		);
		const second = runMcpOAuthAuthorization(
			{} as SidecarContext,
			"remote",
			other,
			vi.fn(),
		);
		await vi.waitFor(() => expect(signals).toHaveLength(2));
		expect(cancelMcpOAuthAuthorizationsForOwner(owner)).toBe(1);
		expect(signals[0].aborted).toBe(true);
		expect(signals[0].reason).toBe("disconnected");
		expect(signals[1].aborted).toBe(false);
		expect(cancelMcpOAuthAuthorization("remote", other)).toBe(true);
		expect(signals[1].reason).toBe("user");
		await Promise.all([first, second]);
	});
});
