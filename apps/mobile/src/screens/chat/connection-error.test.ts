import { describe, expect, it } from "vitest";
import {
	classifyConnectionError,
	describeConnectionError,
} from "./connection-error";

/** Shape of a `HubTransportError` as the connection layer surfaces it. */
function transport(
	code: string,
	message: string,
	details?: { closeCode?: number; closeReason?: string },
) {
	return Object.assign(new Error(message), {
		name: "HubTransportError",
		code,
		details,
	});
}

describe("classifyConnectionError", () => {
	it("treats a missing exact session as terminal instead of retrying elsewhere", () => {
		const error = Object.assign(
			new Error("Session s1 is no longer available"),
			{
				name: "ExactSessionNotFoundError",
			},
		);
		expect(classifyConnectionError(error)).toBe("missing");
		expect(describeConnectionError(error).retryable).toBe(false);
	});

	it("treats a refused attach to a deleted session the same way", () => {
		const error = Object.assign(
			new Error("Could not attach to hub session s1: Unknown session: s1"),
			{ name: "SessionAttachError" },
		);
		expect(classifyConnectionError(error)).toBe("missing");
		expect(describeConnectionError(error).retryable).toBe(false);
	});

	it("reads a failed connect as unreachable", () => {
		expect(
			classifyConnectionError(
				transport(
					"hub_connect_failed",
					"Failed to connect to hub at ws://127.0.0.1:4599/hub (error event before socket open).",
				),
			),
		).toBe("unreachable");
	});

	it("does NOT guess auth for a local 401, which looks identical to a dead port", () => {
		// The hub rejects an unauthorized upgrade with HTTP 401 before the socket
		// opens, so this is the same error a stopped hub produces. Guessing "bad
		// token" here would be wrong half the time.
		expect(
			classifyConnectionError(
				transport("hub_connect_failed", "Failed to connect to hub at ws://h."),
			),
		).toBe("unreachable");
	});

	it("separates a timeout from an unreachable host", () => {
		expect(
			classifyConnectionError(
				transport("hub_connect_timeout", "Timed out connecting to hub"),
			),
		).toBe("timeout");
	});

	it("reads a normal close as dropped", () => {
		expect(
			classifyConnectionError(
				transport(
					"hub_connection_closed",
					"Hub connection closed (code=1006)",
					{
						closeCode: 1006,
					},
				),
			),
		).toBe("dropped");
	});

	it("reads a policy close code as refused", () => {
		expect(
			classifyConnectionError(
				transport(
					"hub_connection_closed",
					"Hub connection closed (code=1008)",
					{
						closeCode: 1008,
					},
				),
			),
		).toBe("refused");
	});

	it("reads an unauthorized close reason as refused", () => {
		expect(
			classifyConnectionError(
				transport("hub_connection_closed", "Hub connection closed", {
					closeCode: 1011,
					closeReason: "Unauthorized token",
				}),
			),
		).toBe("refused");
	});

	it("reads an incompatible protocol as its own terminal kind", () => {
		const error = Object.assign(new Error("client too old"), {
			name: "IncompatibleProtocolError",
			code: "incompatible_protocol",
		});
		expect(classifyConnectionError(error)).toBe("protocol");
		expect(describeConnectionError(error).retryable).toBe(false);
	});

	it("reads a 401 from the cloud gateway as refused", () => {
		const error = Object.assign(new Error("Not signed in to Cline Cloud."), {
			name: "CloudSessionApiError",
			status: 401,
		});
		expect(classifyConnectionError(error)).toBe("refused");
	});

	it("falls back to unknown for an unrecognized error", () => {
		expect(classifyConnectionError(new Error("boom"))).toBe("unknown");
		expect(classifyConnectionError(undefined)).toBe("unknown");
		expect(classifyConnectionError("boom")).toBe("unknown");
	});
});

describe("describeConnectionError", () => {
	it("offers sign-in only for a known expired Cloud credential", () => {
		const error = Object.assign(new Error("Not signed in to Cline Cloud."), {
			name: "CloudSessionApiError",
			status: 401,
		});
		expect(describeConnectionError(error, "cloud")).toMatchObject({
			action: "sign-in",
			retryable: false,
		});
		expect(
			describeConnectionError(
				Object.assign(new Error("Forbidden"), {
					name: "CloudSessionApiError",
					status: 403,
				}),
				"cloud",
			).action,
		).toBeUndefined();
	});
	it("offers Cloud GitHub recovery and new chat for typed terminal sessions", () => {
		expect(
			describeConnectionError(
				Object.assign(new Error("Connect GitHub"), {
					name: "GitHubIntegrationRequiredError",
				}),
				"cloud",
			).action,
		).toBe("connect-github");
		for (const name of [
			"RemoteSessionNotFoundError",
			"RemoteSessionExpiredError",
		]) {
			expect(
				describeConnectionError(
					Object.assign(new Error("gone"), { name }),
					"cloud",
				),
			).toMatchObject({
				kind: "missing",
				action: "new-chat",
				retryable: false,
			});
		}
	});
	it("does not tell Cloud users to restart or pair a computer", () => {
		const presentation = describeConnectionError(
			transport("hub_connect_failed", "socket failed"),
			"cloud",
		);
		expect(presentation.body).toContain("Cline Cloud");
		expect(presentation.body).not.toMatch(/computer|pair/);
	});
	it("keeps the raw message as a demoted detail, never as the headline", () => {
		const raw =
			"Failed to connect to hub at ws://127.0.0.1:4599/hub (error event before socket open).";
		const described = describeConnectionError(
			transport("hub_connect_failed", raw),
		);
		expect(described.headline).toBe("Can't reach this session");
		expect(described.headline).not.toContain("ws://");
		expect(described.detail).toBe(raw);
		expect(described.retryable).toBe(true);
	});

	it("omits the detail when there is nothing technical to show", () => {
		expect(describeConnectionError(undefined).detail).toBeUndefined();
		expect(describeConnectionError(new Error("  "))).not.toHaveProperty(
			"detail",
		);
	});

	it("gives every kind a headline and a one-line body", () => {
		const errors = [
			transport("hub_connect_failed", "x"),
			transport("hub_connect_timeout", "x"),
			transport("hub_connection_closed", "x", { closeCode: 1006 }),
			transport("hub_connection_closed", "x", { closeCode: 1008 }),
			Object.assign(new Error("x"), { code: "incompatible_protocol" }),
			new Error("x"),
		];
		for (const error of errors) {
			const described = describeConnectionError(error);
			expect(described.headline.length).toBeGreaterThan(0);
			expect(described.body.length).toBeGreaterThan(0);
		}
	});
});
