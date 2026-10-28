/** Only the guarded, explicit fixture Metro config resolves this module. */
import * as shippingSecureStore from "expo-secure-store";
import { scopeFixtureSecureStore } from "./secure-store-scope";

// Preserve Expo constants, capability probes and types. All key-bearing APIs
// are overridden; this module's own import bypasses the fixture resolver.
export * from "expo-secure-store";
export const { getItem, setItem, getItemAsync, setItemAsync, deleteItemAsync } =
	scopeFixtureSecureStore(shippingSecureStore);
