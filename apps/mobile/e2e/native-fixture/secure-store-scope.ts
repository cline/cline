/** Simulator fixture storage must never read, overwrite, or delete shipping keys. */
import type * as SecureStore from "expo-secure-store";

type Store = Pick<
	typeof SecureStore,
	"getItem" | "setItem" | "getItemAsync" | "setItemAsync" | "deleteItemAsync"
>;
const PREFIX = "cline.native-fixture.v1.";

export function scopeFixtureSecureStore(store: Store): Store {
	const key = (value: string) => `${PREFIX}${value}`;
	const options = (value: SecureStore.SecureStoreOptions = {}) => ({
		...value,
		keychainService: `${PREFIX}${value.keychainService ?? "app"}`,
	});
	return {
		getItem: (name, config) => store.getItem(key(name), options(config)),
		setItem: (name, value, config) =>
			store.setItem(key(name), value, options(config)),
		getItemAsync: (name, config) =>
			store.getItemAsync(key(name), options(config)),
		setItemAsync: (name, value, config) =>
			store.setItemAsync(key(name), value, options(config)),
		deleteItemAsync: (name, config) =>
			store.deleteItemAsync(key(name), options(config)),
	};
}
