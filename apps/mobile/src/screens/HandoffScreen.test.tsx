/**
 * Arriving from `clinecode://handoff?...`.
 *
 * This is the whole first-run path, so the tests cover both outcomes end to end:
 * a good link saves the machine under its own name and lands in the session, and a
 * bad one explains itself in a sentence while saving nothing.
 */

import { act } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { type ConnectionDescriptor, SavedEndpointsStore } from "@/connection";
import { EndpointsProvider } from "@/state/endpoints";
import type { HandoffLink, HandoffParams } from "@/state/handoff-link";
import { LastOpenedProvider, LastOpenedStore } from "@/state/last-opened";
import { render } from "../ui/__testing__/render";
import { containsText, findByLabel } from "./__testing__/harness";
import { HandoffScreen } from "./HandoffScreen";

const NOW = 1_700_000_000_000;
const KEY = "A".repeat(43);
const SECRET = `${"B".repeat(42)}A`;
const HUB_URL = "ws://192.168.1.20:4599/hub";

function b64url(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function params(overrides: Record<string, string | undefined> = {}) {
	const merged: HandoffParams = {
		v: "1",
		i: "offer-1",
		k: KEY,
		s: SECRET,
		u: b64url(HUB_URL),
		n: "MacBook Pro",
		e: String(NOW + 120_000),
	};
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) {
			delete merged[key];
		} else {
			merged[key] = value;
		}
	}
	return merged;
}

interface Arrival {
	opened: ConnectionDescriptor[];
	paired: ConnectionDescriptor[];
	dismissed: number;
}

async function arrive(handoffParams: HandoffParams) {
	const endpointStore = new SavedEndpointsStore();
	const lastOpenedStore = new LastOpenedStore();
	const arrival: Arrival = { opened: [], paired: [], dismissed: 0 };
	const tree = (currentParams: HandoffParams) => (
		<EndpointsProvider store={endpointStore}>
			<LastOpenedProvider store={lastOpenedStore}>
				<HandoffScreen
					params={currentParams}
					now={NOW}
					pair={async (link: HandoffLink) => ({
						mode: "local",
						transport: "relay",
						url: link.url,
						label: link.machineName,
						...(link.hubSessionId ? { hubSessionId: link.hubSessionId } : {}),
					})}
					onOpenSession={(descriptor) => {
						arrival.opened.push(descriptor);
					}}
					onPaired={(descriptor) => {
						arrival.paired.push(descriptor);
					}}
					onDismiss={() => {
						arrival.dismissed += 1;
					}}
				/>
			</LastOpenedProvider>
		</EndpointsProvider>
	);
	const result = render(tree(handoffParams));
	await act(async () => {});
	return {
		...result,
		endpointStore,
		lastOpenedStore,
		arrival,
		/** Re-render with a fresh params object, as a router re-render would. */
		rerender: async (nextParams: HandoffParams = { ...handoffParams }) => {
			await act(async () => {
				result.renderer.update(tree(nextParams));
			});
		},
	};
}

describe("HandoffScreen, good link", () => {
	it("saves the machine under its own name and opens the named session", async () => {
		const { endpointStore, arrival } = await arrive(
			params({ sid: "hub-session-7" }),
		);
		expect(endpointStore.list()).toEqual([
			{
				mode: "local",
				transport: "relay",
				url: HUB_URL,
				label: "MacBook Pro",
				hubSessionId: "hub-session-7",
			},
		]);
		expect(arrival.opened).toHaveLength(1);
		expect(arrival.opened[0]?.hubSessionId).toBe("hub-session-7");
		expect(arrival.paired).toHaveLength(0);
	});

	it("records the arrival so the list can order by it", async () => {
		const { lastOpenedStore } = await arrive(params({ sid: "s1" }));
		expect(lastOpenedStore.get(`["local","${HUB_URL}","s1"]`)).toBeGreaterThan(
			0,
		);
	});

	it("lands on the session list when the machine named no session", async () => {
		const { arrival } = await arrive(params());
		expect(arrival.paired).toHaveLength(1);
		expect(arrival.opened).toHaveLength(0);
	});

	it("says which computer it is connecting to while it works", async () => {
		const { root } = await arrive(params({ sid: "s1" }));
		expect(containsText(root, "Connecting to MacBook Pro")).toBe(true);
	});

	it("consumes the link exactly once across re-renders", async () => {
		const { rerender, arrival, endpointStore } = await arrive(
			params({ sid: "s1" }),
		);
		// A parent re-render (a new params object from the router) must not re-run a
		// single-use ceremony or navigate twice.
		await rerender();
		await rerender();
		expect(arrival.opened).toHaveLength(1);
		expect(endpointStore.list()).toHaveLength(1);
	});
});

describe("HandoffScreen, bad link", () => {
	it("explains an expired link and saves nothing", async () => {
		const { root, endpointStore, arrival } = await arrive(
			params({ e: String(NOW - 1) }),
		);
		expect(containsText(root, "didn’t work")).toBe(true);
		expect(containsText(root, "expired")).toBe(true);
		expect(containsText(root, "/handoff")).toBe(true);
		expect(endpointStore.list()).toEqual([]);
		expect(arrival.opened).toHaveLength(0);
		expect(arrival.paired).toHaveLength(0);
	});

	it("explains a malformed link without printing a stack trace", async () => {
		const { root, endpointStore } = await arrive(params({ k: "not-a-key" }));
		expect(containsText(root, "damaged")).toBe(true);
		expect(containsText(root, "Error")).toBe(false);
		expect(containsText(root, "at Object")).toBe(false);
		expect(endpointStore.list()).toEqual([]);
	});

	it("explains an incomplete link", async () => {
		const { root } = await arrive(params({ u: undefined }));
		expect(containsText(root, "incomplete")).toBe(true);
	});

	it("tells the user to update when the version is unknown", async () => {
		const { root } = await arrive(params({ v: "2" }));
		expect(containsText(root, "does not support")).toBe(true);
		expect(containsText(root, "Update Cline on your phone")).toBe(true);
	});

	it("offers a way back to the session list", async () => {
		const { root, arrival } = await arrive(params({ e: "1" }));
		await act(async () => {
			findByLabel(root, "Back to sessions")?.props.onPress();
		});
		expect(arrival.dismissed).toBe(1);
	});

	it("refuses an empty deep link (no params at all)", async () => {
		const { root, endpointStore } = await arrive({});
		expect(containsText(root, "missing its version")).toBe(true);
		expect(endpointStore.list()).toEqual([]);
	});
});
