import { describe, expect, it } from "vitest";
import type { ConnectionDescriptor } from "@/connection";
import {
	describeEndpoints,
	endpointAuthority,
	endpointPort,
} from "./endpoint-display";

function local(url: string, label?: string): ConnectionDescriptor {
	return { mode: "local", url, ...(label ? { label } : {}) };
}

describe("endpointAuthority / endpointPort", () => {
	it("reads host and port out of a hub url", () => {
		expect(endpointAuthority("ws://127.0.0.1:4599/hub")).toBe("127.0.0.1:4599");
		expect(endpointPort("ws://127.0.0.1:4599/hub")).toBe("4599");
		expect(endpointPort("wss://hub.example.com:25463")).toBe("25463");
	});

	it("drops userinfo rather than showing a credential in the label", () => {
		expect(endpointAuthority("ws://user:secret@127.0.0.1:4599/hub")).toBe(
			"127.0.0.1:4599",
		);
	});

	it("reports no port when there is none to report", () => {
		expect(endpointPort("ws://hub.example.com/hub")).toBeUndefined();
		expect(endpointPort("ws://[::1]")).toBeUndefined();
		expect(endpointPort("not a url")).toBeUndefined();
		expect(endpointAuthority("not a url")).toBeUndefined();
	});
});

describe("describeEndpoints", () => {
	it("keeps a unique label exactly as saved", () => {
		const rows = describeEndpoints([
			local("ws://127.0.0.1:4599/hub", "Local dev hub"),
			local("ws://127.0.0.1:25463/hub", "Work laptop"),
		]);
		expect(rows.map((row) => row.label)).toEqual([
			"Local dev hub",
			"Work laptop",
		]);
		expect(rows.every((row) => row.disambiguated === false)).toBe(true);
	});

	it("disambiguates identical labels by port — the actual device bug", () => {
		const rows = describeEndpoints([
			local("ws://127.0.0.1:4599/hub", "Local dev hub"),
			local("ws://127.0.0.1:25463/hub", "Local dev hub"),
		]);
		expect(rows.map((row) => row.label)).toEqual([
			"Local dev hub (:4599)",
			"Local dev hub (:25463)",
		]);
		expect(rows.every((row) => row.disambiguated)).toBe(true);
		// Labels are unique, which is the whole point.
		expect(new Set(rows.map((row) => row.label)).size).toBe(2);
	});

	it("falls back to the full url when label and port both collide", () => {
		const rows = describeEndpoints([
			local("ws://127.0.0.1:4599/hub", "Local dev hub"),
			local("ws://127.0.0.1:4599/other", "Local dev hub"),
		]);
		expect(rows.map((row) => row.label)).toEqual([
			"Local dev hub (ws://127.0.0.1:4599/hub)",
			"Local dev hub (ws://127.0.0.1:4599/other)",
		]);
		expect(new Set(rows.map((row) => row.label)).size).toBe(2);
	});

	it("names an unlabelled endpoint after its host:port", () => {
		const rows = describeEndpoints([local("ws://127.0.0.1:4599/hub")]);
		expect(rows[0]?.label).toBe("127.0.0.1:4599");
	});

	it("is deterministic and order-preserving", () => {
		const endpoints = [
			local("ws://a:1/hub", "Hub"),
			local("ws://b:2/hub", "Hub"),
			local("ws://c:3/hub", "Other"),
		];
		const first = describeEndpoints(endpoints);
		const second = describeEndpoints(endpoints);
		expect(first).toEqual(second);
		expect(first.map((row) => row.url)).toEqual([
			"ws://a:1/hub",
			"ws://b:2/hub",
			"ws://c:3/hub",
		]);
	});

	it("exposes the descriptor key so a row can be removed", () => {
		const rows = describeEndpoints([local("ws://127.0.0.1:4599/hub", "Hub")]);
		expect(rows[0]?.key).toBe(
			JSON.stringify(["local", "ws://127.0.0.1:4599/hub"]),
		);
	});

	it("handles an empty list", () => {
		expect(describeEndpoints([])).toEqual([]);
	});
});
