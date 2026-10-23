import type { ClineOAuthCredentials } from "@cline/core/auth/cline-device";
import { describe, expect, it, vi } from "vitest";
import { ClineAuthStore, createInMemoryAuthStorage } from "./store";

function credentials(
	overrides: Partial<ClineOAuthCredentials> = {},
): ClineOAuthCredentials {
	return {
		access: "jwt",
		refresh: "refresh",
		expires: 10_000,
		accountId: "usr-1",
		email: "user@test",
		metadata: { provider: "cline" },
		...overrides,
	};
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("ClineAuthStore", () => {
	it("returns the SDK-resolved access token", async () => {
		const resolveCredentials = vi.fn(async (current) => current);
		const store = new ClineAuthStore({
			storage: createInMemoryAuthStorage(credentials()),
			apiBaseUrl: "https://api.test",
			resolveCredentials,
		});

		expect(await store.getValidAccessToken()).toBe("jwt");
		expect(resolveCredentials).toHaveBeenCalledWith(
			expect.objectContaining({ access: "jwt" }),
			{ apiBaseUrl: "https://api.test", provider: "cline" },
		);
	});

	it("persists refreshed credentials returned by the SDK", async () => {
		const storage = createInMemoryAuthStorage(credentials({ access: "old" }));
		const refreshed = credentials({ access: "fresh", refresh: "refresh-2" });
		const store = new ClineAuthStore({
			storage,
			resolveCredentials: vi.fn(async () => refreshed),
		});

		expect(await store.getValidAccessToken()).toBe("fresh");
		expect(await storage.load()).toEqual(refreshed);
	});

	it("coalesces concurrent credential resolution", async () => {
		const resolveCredentials = vi.fn(async () =>
			credentials({ access: "fresh" }),
		);
		const store = new ClineAuthStore({
			storage: createInMemoryAuthStorage(credentials()),
			resolveCredentials,
		});
		const [left, right] = await Promise.all([
			store.getValidAccessToken(),
			store.getValidAccessToken(),
		]);

		expect(left).toBe("fresh");
		expect(right).toBe("fresh");
		expect(resolveCredentials).toHaveBeenCalledTimes(1);
	});

	it("clears rejected credentials when the SDK returns null", async () => {
		const storage = createInMemoryAuthStorage(credentials());
		const store = new ClineAuthStore({
			storage,
			resolveCredentials: vi.fn(async () => null),
		});

		expect(await store.getValidAccessToken()).toBeNull();
		expect(await storage.load()).toBeNull();
	});

	it("leaves stored credentials intact when the SDK throws", async () => {
		const existing = credentials();
		const storage = createInMemoryAuthStorage(existing);
		const store = new ClineAuthStore({
			storage,
			resolveCredentials: vi.fn(async () => {
				throw new Error("network");
			}),
		});

		await expect(store.getValidAccessToken()).rejects.toThrow("network");
		expect(await storage.load()).toEqual(existing);
	});

	it("does not re-persist a refresh that resolves after signOut", async () => {
		const storage = createInMemoryAuthStorage(credentials({ access: "old" }));
		let signalStarted: () => void = () => {};
		let releaseRefresh: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			signalStarted = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			releaseRefresh = resolve;
		});
		const store = new ClineAuthStore({
			storage,
			resolveCredentials: vi.fn(async () => {
				signalStarted();
				await gate;
				return credentials({ access: "fresh", refresh: "refresh-2" });
			}),
		});

		const pending = store.getValidAccessToken();
		await started;
		await store.signOut();
		releaseRefresh();

		// The abandoned attempt resolves to nothing, and nothing is written back.
		expect(await pending).toBeNull();
		expect(await storage.load()).toBeNull();
		expect(await store.getCredentials()).toBeNull();
		expect(await store.isSignedIn()).toBe(false);
	});

	it.each([
		"sign-in",
		"refresh",
	] as const)("clears storage when signOut interrupts a %s save", async (operation) => {
		const storage = createInMemoryAuthStorage(credentials());
		const store = new ClineAuthStore({
			storage,
			resolveCredentials: async () => credentials({ access: "fresh" }),
		});
		const saving = deferred<void>();
		const finishSave = deferred<void>();
		const save = storage.save.bind(storage);
		storage.save = async (next) => {
			saving.resolve();
			await finishSave.promise;
			await save(next);
		};
		const pending =
			operation === "sign-in"
				? store.setCredentials(credentials({ access: "fresh" }))
				: store.getValidAccessToken();
		await saving.promise;
		const signedOut = store.signOut();
		finishSave.resolve();
		const [result] = await Promise.all([pending, signedOut]);

		if (operation === "refresh") expect(result).toBeNull();
		expect(await storage.load()).toBeNull();
		expect(await store.getCredentials()).toBeNull();
	});

	it("does not restore credentials from an initial read completed after signOut", async () => {
		const existing = credentials();
		let finishLoad: (value: ClineOAuthCredentials) => void = () => {};
		const delayedLoad = new Promise<ClineOAuthCredentials>((resolve) => {
			finishLoad = resolve;
		});
		const storage = createInMemoryAuthStorage(existing);
		storage.load = vi
			.fn()
			.mockResolvedValueOnce(existing)
			.mockReturnValueOnce(delayedLoad);
		const store = new ClineAuthStore({
			storage,
			resolveCredentials: async (current) => current,
		});
		const first = store.getCredentials();
		const second = store.getValidAccessToken();
		await first;
		await store.signOut();
		finishLoad(existing);

		expect(await second).toBeNull();
		expect(await store.isSignedIn()).toBe(false);
		expect(await store.getValidAccessToken()).toBeNull();
	});

	it("keeps a new sign-in durable when an older save finishes after signOut", async () => {
		const storage = createInMemoryAuthStorage();
		const saving = deferred<void>();
		const finishSave = deferred<void>();
		const save = storage.save.bind(storage);
		storage.save = async (next) => {
			if (next.access === "older") {
				saving.resolve();
				await finishSave.promise;
			}
			await save(next);
		};
		const store = new ClineAuthStore({ storage });
		const older = store.setCredentials(credentials({ access: "older" }));
		await saving.promise;
		const signedOut = store.signOut();
		const latest = credentials({ access: "new-account" });
		const signedIn = store.setCredentials(latest);
		finishSave.resolve();
		await Promise.all([older, signedOut, signedIn]);

		expect(await store.getCredentials()).toEqual(latest);
		expect(await new ClineAuthStore({ storage }).getCredentials()).toEqual(
			latest,
		);
	});

	it.each([
		"sign-in",
		"sign-out then sign-in",
	])("keeps the new refresh shared after %s while the old refresh finishes", async (transition) => {
		const oldRefresh = deferred<ClineOAuthCredentials>();
		const newRefresh = deferred<ClineOAuthCredentials>();
		const oldStarted = deferred<void>();
		const newStarted = deferred<void>();
		const resolveCredentials = vi
			.fn()
			.mockImplementationOnce(() => {
				oldStarted.resolve();
				return oldRefresh.promise;
			})
			.mockImplementation(() => {
				newStarted.resolve();
				return newRefresh.promise;
			});
		const storage = createInMemoryAuthStorage(credentials({ access: "old" }));
		const store = new ClineAuthStore({ storage, resolveCredentials });
		const abandoned = store.getValidAccessToken();
		await oldStarted.promise;
		if (transition === "sign-out then sign-in") await store.signOut();
		await store.setCredentials(credentials({ access: "new-account" }));
		const current = store.getValidAccessToken();
		await newStarted.promise;
		oldRefresh.resolve(credentials({ access: "old-refreshed" }));
		expect(await abandoned).toBeNull();
		const joined = store.getValidAccessToken();
		await Promise.resolve();
		newRefresh.resolve(credentials({ access: "new-refreshed" }));

		expect(await Promise.all([current, joined])).toEqual([
			"new-refreshed",
			"new-refreshed",
		]);
		expect(resolveCredentials).toHaveBeenCalledTimes(2);
		expect((await storage.load())?.access).toBe("new-refreshed");
	});

	it("still clears storage after an earlier save rejects", async () => {
		const storage = createInMemoryAuthStorage(credentials());
		storage.save = vi.fn().mockRejectedValue(new Error("Keychain unavailable"));
		const store = new ClineAuthStore({ storage });
		const saving = store.setCredentials(credentials({ access: "fresh" }));
		const signedOut = store.signOut();

		await expect(saving).rejects.toThrow("Keychain unavailable");
		await signedOut;
		expect(await storage.load()).toBeNull();
		expect(await store.getCredentials()).toBeNull();
	});

	it("signOut clears secure storage", async () => {
		const storage = createInMemoryAuthStorage(credentials());
		const store = new ClineAuthStore({
			storage,
			resolveCredentials: vi.fn(async (current) => current),
		});
		expect(await store.isSignedIn()).toBe(true);
		await store.signOut();
		expect(await store.isSignedIn()).toBe(false);
		expect(await storage.load()).toBeNull();
	});

	it("signs out without any network call (revocation is a known gap)", async () => {
		const fetchSpy = vi.fn();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		try {
			const storage = createInMemoryAuthStorage(credentials());
			const store = new ClineAuthStore({ storage });

			await store.signOut();

			expect(fetchSpy).not.toHaveBeenCalled();
			expect(await storage.load()).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
