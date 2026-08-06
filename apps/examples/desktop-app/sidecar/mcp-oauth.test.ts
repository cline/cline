import type {
	AuthorizeMcpServerOAuthOptions,
	AuthorizeMcpServerOAuthResult,
} from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import {
	cancelMcpOAuthAuthorization,
	cancelMcpOAuthAuthorizationsForOwner,
	McpOAuthAuthorizationCancelledError,
	runCancellableMcpOAuthAuthorization,
} from "./mcp-oauth";

function waitForAbort(
	options: AuthorizeMcpServerOAuthOptions,
): Promise<AuthorizeMcpServerOAuthResult> {
	return new Promise((_, reject) => {
		if (options.signal?.aborted) {
			reject(new Error("aborted"));
			return;
		}
		options.signal?.addEventListener(
			"abort",
			() => reject(new Error("aborted")),
			{ once: true },
		);
	});
}

describe("desktop MCP OAuth authorization", () => {
	it("starts browser authorization only through the explicit runner", async () => {
		const authorize = vi.fn(
			async (
				options: AuthorizeMcpServerOAuthOptions,
			): Promise<AuthorizeMcpServerOAuthResult> => ({
				serverName: options.serverName,
				authorized: true,
				message: "authorized",
			}),
		);

		await expect(
			runCancellableMcpOAuthAuthorization({ serverName: "github" }, undefined, {
				authorize,
			}),
		).resolves.toMatchObject({ authorized: true });
		expect(authorize).toHaveBeenCalledOnce();
		expect(authorize.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
	});

	it("cancels a pending callback when the server is turned off", async () => {
		const pending = runCancellableMcpOAuthAuthorization(
			{ serverName: "github" },
			undefined,
			{ authorize: waitForAbort },
		);

		expect(cancelMcpOAuthAuthorization("github")).toBe(true);
		await expect(pending).rejects.toBeInstanceOf(
			McpOAuthAuthorizationCancelledError,
		);
		expect(cancelMcpOAuthAuthorization("github")).toBe(false);
	});

	it("cancels an abandoned flow when its webview connection closes", async () => {
		const owner = {};
		const pending = runCancellableMcpOAuthAuthorization(
			{ serverName: "linear" },
			owner,
			{ authorize: waitForAbort },
		);

		expect(cancelMcpOAuthAuthorizationsForOwner({})).toBe(0);
		expect(cancelMcpOAuthAuthorizationsForOwner(owner)).toBe(1);
		await expect(pending).rejects.toBeInstanceOf(
			McpOAuthAuthorizationCancelledError,
		);
	});
});
