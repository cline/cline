import { describe, expect, it } from "vitest";
import {
	asHubSessionId,
	asRemoteSessionId,
	type HubSessionId,
	type RemoteSessionId,
} from "./ids";

describe("branded session ids", () => {
	it("carries the underlying string value", () => {
		expect(asRemoteSessionId("rs_1")).toBe("rs_1");
		expect(asHubSessionId("ses_1")).toBe("ses_1");
		expect(`${asHubSessionId("ses_1")}/x`).toBe("ses_1/x");
	});

	it("rejects blank ids", () => {
		expect(() => asRemoteSessionId(" ")).toThrow(/remote session id/i);
		expect(() => asHubSessionId("")).toThrow(/hub session id/i);
	});

	it("trims surrounding whitespace", () => {
		expect(asHubSessionId(" ses_1 ")).toBe("ses_1");
	});

	it("does not let the two id kinds cross-assign", () => {
		const remote = asRemoteSessionId("rs_1");
		const hub = asHubSessionId("ses_1");
		// @ts-expect-error a RemoteSessionId is not a HubSessionId
		const notAHubId: HubSessionId = remote;
		// @ts-expect-error a HubSessionId is not a RemoteSessionId
		const notARemoteId: RemoteSessionId = hub;
		expect([notAHubId, notARemoteId]).toEqual(["rs_1", "ses_1"]);
	});

	it("does not accept a bare string for either brand", () => {
		// @ts-expect-error branded ids must go through their constructor
		const hub: HubSessionId = "ses_1";
		// @ts-expect-error branded ids must go through their constructor
		const remote: RemoteSessionId = "rs_1";
		expect([hub, remote]).toEqual(["ses_1", "rs_1"]);
	});
});
