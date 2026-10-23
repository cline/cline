import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
	getItemAsync: vi.fn(),
	setItemAsync: vi.fn(),
}));
vi.mock("expo-secure-store", () => store);

beforeEach(() => {
	vi.resetModules();
	vi.resetAllMocks();
});

describe("Cloud client identity", () => {
	it("persists before use, survives restart, and separates workspaces", async () => {
		let stored: string | null = null;
		store.getItemAsync.mockImplementation(async () => stored);
		store.setItemAsync.mockImplementation(async (_key, value) => {
			stored = value;
		});
		const { cloudClientId } = await import("./cloud-client-identity");
		const [first, parallel] = await Promise.all([
			cloudClientId("a"),
			cloudClientId("a"),
		]);
		expect(first).toBe(parallel);
		expect(store.setItemAsync).toHaveBeenCalledTimes(1);
		expect(await cloudClientId("b")).not.toBe(first);
		vi.resetModules();
		const restarted = await import("./cloud-client-identity");
		expect(await restarted.cloudClientId("a")).toBe(first);
	});
	it("does not create an ephemeral identity when persistence fails; retries later", async () => {
		store.getItemAsync.mockResolvedValue(null);
		store.setItemAsync
			.mockRejectedValueOnce(new Error("Keychain unavailable"))
			.mockResolvedValue(undefined);
		const { cloudClientId } = await import("./cloud-client-identity");
		await expect(cloudClientId("a")).rejects.toThrow("Keychain unavailable");
		await expect(cloudClientId("a")).resolves.toMatch(/^mobile-/);
		expect(store.setItemAsync).toHaveBeenCalledTimes(2);
	});
});
