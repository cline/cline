import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import type * as SecureStore from "expo-secure-store";
import { describe, expect, it, vi } from "vitest";
import { scopeFixtureSecureStore } from "../../e2e/native-fixture/secure-store-scope";

function fixtureStore() {
	const values = new Map<string, string>();
	const address = (key: string, options?: SecureStore.SecureStoreOptions) =>
		`${options?.keychainService ?? "app"}:${key}`;
	const getItem = vi.fn(
		(key: string, options?: SecureStore.SecureStoreOptions) =>
			values.get(address(key, options)) ?? null,
	);
	const setItem = vi.fn(
		(key: string, value: string, options?: SecureStore.SecureStoreOptions) => {
			values.set(address(key, options), value);
		},
	);
	const native = {
		getItem,
		setItem,
		getItemAsync: vi.fn(
			async (key: string, options?: SecureStore.SecureStoreOptions) =>
				getItem(key, options),
		),
		setItemAsync: vi.fn(
			async (
				key: string,
				value: string,
				options?: SecureStore.SecureStoreOptions,
			) => setItem(key, value, options),
		),
		deleteItemAsync: vi.fn(
			async (key: string, options?: SecureStore.SecureStoreOptions) => {
				values.delete(address(key, options));
			},
		),
	};
	return { native, scoped: scopeFixtureSecureStore(native) };
}

describe("isolated native fixture SecureStore", () => {
	it("cannot read, overwrite or delete ordinary app values, including credentials", async () => {
		const { native, scoped } = fixtureStore();
		for (const key of [
			"cline.mobile.executionTargets.v1",
			"cline.mobile.cloudAuth.v1",
			"cline.mobile.task-alerts.v1",
		]) {
			await native.setItemAsync(key, "ordinary app value");
			expect(await scoped.getItemAsync(key)).toBeNull();
			expect(scoped.getItem(key)).toBeNull();
			await scoped.setItemAsync(key, "fixture async value");
			expect(scoped.getItem(key)).toBe("fixture async value");
			scoped.setItem(key, "fixture sync value");
			expect(await scoped.getItemAsync(key)).toBe("fixture sync value");
			await scoped.deleteItemAsync(key);
			expect(await scoped.getItemAsync(key)).toBeNull();
			expect(await native.getItemAsync(key)).toBe("ordinary app value");
		}
	});
	it("namespaces explicit keychain services and preserves options without mutating the caller", async () => {
		const { native, scoped } = fixtureStore();
		const options = {
			keychainService: "custom",
			requireAuthentication: true,
			keychainAccessible: 7,
		};
		await native.setItemAsync("key", "ordinary", options);
		await scoped.setItemAsync("key", "fixture", options);
		expect(native.setItemAsync).toHaveBeenLastCalledWith(
			"cline.native-fixture.v1.key",
			"fixture",
			{ ...options, keychainService: "cline.native-fixture.v1.custom" },
		);
		expect(options.keychainService).toBe("custom");
		expect(await scoped.getItemAsync("key", options)).toBe("fixture");
		await scoped.deleteItemAsync("key", options);
		expect(await native.getItemAsync("key", options)).toBe("ordinary");
	});
	it("exports scoped public operations from the actual Metro replacement", async () => {
		const fixture = await import(
			"../../e2e/native-fixture/fixture-secure-store"
		);
		const native = await import("expo-secure-store");
		for (const name of [
			"getItem",
			"setItem",
			"getItemAsync",
			"setItemAsync",
			"deleteItemAsync",
		] as const)
			expect(typeof fixture[name]).toBe("function");
		await fixture.getItemAsync("key");
		expect(native.getItemAsync).toHaveBeenLastCalledWith(
			"cline.native-fixture.v1.key",
			{ keychainService: "cline.native-fixture.v1.app" },
		);
		await fixture.setItemAsync("key", "fixture");
		expect(native.setItemAsync).toHaveBeenLastCalledWith(
			"cline.native-fixture.v1.key",
			"fixture",
			{ keychainService: "cline.native-fixture.v1.app" },
		);
		await fixture.deleteItemAsync("key");
		expect(native.deleteItemAsync).toHaveBeenLastCalledWith(
			"cline.native-fixture.v1.key",
			{ keychainService: "cline.native-fixture.v1.app" },
		);
	});

	it("the explicit Metro guard redirects SecureStore while the wrapper imports the real Expo module", () => {
		const directory = fileURLToPath(
			new URL("../../e2e/native-fixture/", import.meta.url).href,
		);
		const source = readFileSync(
			path.join(directory, "metro.config.cjs"),
			"utf8",
		);
		const evaluate = (enabled?: string) => {
			const original = vi.fn(
				(
					_context: { originModulePath: string },
					_name: string,
					_platform: string,
				) => ({
					type: "sourceFile",
					filePath: _name.endsWith("config/env")
						? path.resolve(directory, "../../src/config/env.ts")
						: "real-expo-secure-store.ts",
				}),
			);
			const config = { resolver: { resolveRequest: original } };
			const sandbox = {
				process: { env: { CLINE_NATIVE_FIXTURE_BUILD: enabled } },
				__dirname: directory,
				module: { exports: {} },
				require: (name: string) => (name === "node:path" ? path : config),
			};
			vm.runInNewContext(source, sandbox);
			return { resolver: config.resolver.resolveRequest, original };
		};
		expect(() => evaluate()).toThrow("CLINE_NATIVE_FIXTURE_BUILD=1");
		const { resolver, original } = evaluate("1");
		const wrapper = path.join(directory, "fixture-secure-store.ts");
		expect(
			resolver(
				{ originModulePath: "/app/src/store.ts" },
				"expo-secure-store",
				"ios",
			),
		).toEqual({ type: "sourceFile", filePath: wrapper });
		expect(
			resolver({ originModulePath: wrapper }, "expo-secure-store", "ios"),
		).toEqual({ type: "sourceFile", filePath: "real-expo-secure-store.ts" });
		expect(original).toHaveBeenCalledOnce();
		const fixtureEnv = path.join(directory, "fixture-env.ts");
		expect(
			resolver({ originModulePath: "/app/src/auth.ts" }, "@/config/env", "ios"),
		).toEqual({ type: "sourceFile", filePath: fixtureEnv });
		expect(
			resolver({ originModulePath: fixtureEnv }, "../../src/config/env", "ios"),
		).toEqual({
			type: "sourceFile",
			filePath: path.resolve(directory, "../../src/config/env.ts"),
		});
		const shipping = readFileSync(
			fileURLToPath(new URL("../../metro.config.js", import.meta.url).href),
			"utf8",
		);
		expect(shipping).not.toContain("fixture-secure-store");
		expect(shipping).not.toContain("CLINE_NATIVE_FIXTURE_BUILD");
	});
});
