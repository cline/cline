import { describe, expect, it } from "vitest";
import {
	type ConnectionDescriptor,
	chatRouteParams,
	descriptorKey,
	type EndpointPersistence,
	SavedEndpointsStore,
} from "./endpoints";

const local: ConnectionDescriptor = {
	mode: "local",
	url: "ws://127.0.0.1:4599/hub",
	authToken: "tok",
};
const cloud: ConnectionDescriptor = {
	mode: "cloud",
	url: "https://sandbox.example/hub",
};

function memoryPersistence(): EndpointPersistence & {
	store: Map<string, string>;
} {
	const store = new Map<string, string>();
	return {
		store,
		async getItem(key) {
			return store.get(key) ?? null;
		},
		async setItem(key, value) {
			store.set(key, value);
		},
		async deleteItem(key) {
			store.delete(key);
		},
	};
}

describe("descriptorKey", () => {
	it("is identity by mode + url, ignoring token/label", () => {
		expect(descriptorKey(local)).toBe(
			descriptorKey({ ...local, authToken: "x" }),
		);
		expect(descriptorKey(local)).not.toBe(descriptorKey(cloud));
		expect(descriptorKey(local)).not.toContain("\0");
	});

	it("does not collide when a URL contains separator-like text", () => {
		expect(
			descriptorKey({ mode: "local", url: "cloud:https://example.test" }),
		).not.toBe(descriptorKey({ mode: "cloud", url: "https://example.test" }));
	});

	it("separates account-routed relay machines that share one URL", () => {
		const first = {
			...local,
			transport: "relay" as const,
			relayMachineId: "mac-1",
		};
		const second = { ...first, relayMachineId: "mac-2" };
		expect(descriptorKey(first)).not.toBe(descriptorKey(second));
	});
});

describe("chatRouteParams", () => {
	it("routes by endpoint key without exposing credentials", () => {
		expect(chatRouteParams(local)).toEqual({
			endpointKey: descriptorKey(local),
		});
		expect(JSON.stringify(chatRouteParams(local))).not.toContain("tok");
		expect(chatRouteParams(local, true)).toEqual({
			endpointKey: descriptorKey(local),
			newSession: "1",
		});
	});
});

describe("SavedEndpointsStore", () => {
	it("persists Cloud repository context without changing connection identity", async () => {
		const persistence = memoryPersistence();
		const store = new SavedEndpointsStore(persistence);
		const descriptor = {
			...cloud,
			repoUrl: "https://github.com/cline/cline.git",
			branch: "feature/mobile",
		};
		expect(descriptorKey(descriptor)).toBe(descriptorKey(cloud));
		await store.save(descriptor);
		const revived = new SavedEndpointsStore(persistence);
		await revived.hydrate();
		expect(revived.get(descriptorKey(cloud))).toEqual(descriptor);
	});
	it("adds, de-dupes by key, and moves the newest to the front", async () => {
		const store = new SavedEndpointsStore();
		await store.save(local);
		await store.save(cloud);
		await store.save({ ...local, authToken: "rotated" });

		const list = store.list();
		expect(list.map(descriptorKey)).toEqual([
			descriptorKey(local),
			descriptorKey(cloud),
		]);
		expect(store.get(descriptorKey(local))?.authToken).toBe("rotated");
	});

	it("keeps a reusable computer target beside its exact resumed session", async () => {
		const store = new SavedEndpointsStore();
		const exact = {
			...local,
			hubSessionId: "inner-1",
			sessionTitle: "Review mobile",
		};
		await store.save(local);
		await store.save(exact);

		expect(store.list()).toEqual([exact, local]);
		expect(descriptorKey(exact)).not.toBe(descriptorKey(local));
	});

	it("notifies subscribers on change", async () => {
		const store = new SavedEndpointsStore();
		const seen: number[] = [];
		store.subscribe((endpoints) => seen.push(endpoints.length));
		await store.save(local);
		await store.remove(descriptorKey(local));
		expect(seen).toEqual([1, 0]);
	});

	it("persists write-through and rehydrates", async () => {
		const persistence = memoryPersistence();
		const store = new SavedEndpointsStore(persistence);
		await store.save(local);
		await store.save(cloud);

		const revived = new SavedEndpointsStore(persistence);
		await revived.hydrate();
		expect(revived.list().map(descriptorKey)).toEqual([
			descriptorKey(cloud),
			descriptorKey(local),
		]);
	});

	it("serializes writes so stale state cannot finish after a newer save", async () => {
		const pendingWrites: Array<{
			value: string;
			finish(): void;
		}> = [];
		let persisted: string | undefined;
		const persistence: EndpointPersistence = {
			async getItem() {
				return persisted ?? null;
			},
			setItem(_key, value) {
				return new Promise<void>((resolve) => {
					pendingWrites.push({
						value,
						finish: () => {
							persisted = value;
							resolve();
						},
					});
				});
			},
			async deleteItem() {},
		};
		const store = new SavedEndpointsStore(persistence);
		const withPrompt = { ...cloud, pendingInitialMessage: "Run once" };
		const first = store.save(withPrompt);
		await Promise.resolve();
		const second = store.save(cloud);
		await Promise.resolve();
		expect(pendingWrites).toHaveLength(1);

		pendingWrites[0]?.finish();
		await first;
		await Promise.resolve();
		expect(pendingWrites).toHaveLength(2);
		pendingWrites[1]?.finish();
		await second;

		expect(JSON.parse(persisted ?? "null")).toEqual([cloud]);
	});

	it("rehydrates a pending Cloud first prompt from secure persistence", async () => {
		const persistence = memoryPersistence();
		const pending: ConnectionDescriptor = {
			...cloud,
			remoteSessionId: "remote-1",
			pendingInitialMessage: "Finish the mobile session flow",
		};
		await new SavedEndpointsStore(persistence).save(pending);

		const revived = new SavedEndpointsStore(persistence);
		await revived.hydrate();
		expect(revived.list()).toEqual([pending]);
	});

	it("rehydrates a paired row with its credential kind and keys intact", async () => {
		const persistence = memoryPersistence();
		const paired = {
			mode: "local" as const,
			transport: "direct" as const,
			credentialKind: "device-key" as const,
			url: "ws://192.168.1.20:25463/hub",
			label: "Examples MacBook Pro",
			hubPublicKey: "FAKE-hub-public-key-not-real-000000000000000",
			devicePrivateKey: "FAKE-device-private-key-not-real-00000000000",
		};
		await new SavedEndpointsStore(persistence).save(paired);
		const revived = new SavedEndpointsStore(persistence);
		await revived.hydrate();
		expect(revived.list()[0]).toEqual(paired);
	});

	it("drops a row whose credential kind is not one this build knows", async () => {
		// A future kind must not be read as the absent-means-token default, which
		// would make the app present an empty token instead of refusing.
		const persistence = memoryPersistence();
		persistence.store.set(
			"cline.mobile.savedEndpoints.v1",
			JSON.stringify([
				{ mode: "local", url: "ws://a/hub", credentialKind: "passkey" },
				{ mode: "local", url: "ws://b/hub", credentialKind: "hub-token" },
			]),
		);
		const store = new SavedEndpointsStore(persistence);
		await store.hydrate();
		expect(store.list().map((entry) => entry.url)).toEqual(["ws://b/hub"]);
	});

	it("discards a corrupt persisted blob without throwing", async () => {
		const persistence = memoryPersistence();
		persistence.store.set("cline.mobile.savedEndpoints.v1", "{not json");
		const store = new SavedEndpointsStore(persistence);
		await expect(store.hydrate()).resolves.toBeUndefined();
		expect(store.list()).toEqual([]);
	});
});
