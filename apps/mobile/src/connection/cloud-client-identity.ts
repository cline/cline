// Hub client contributions (including ask_question) remain bound to their
// creator. Keep our own random identity across reconnects and app restarts;
// never adopt an ID read from someone else's session. Authentication is still
// the account token, not this routing identity.
const STORAGE_KEY = "cline.mobile.cloud-client-identity.v1";
let identity: Promise<string> | undefined;

export async function cloudClientId(remoteSessionId: string): Promise<string> {
	identity ??= loadIdentity().catch((error) => {
		identity = undefined;
		throw error;
	});
	// Separate workspaces may be open concurrently without sharing a socket ID.
	return `mobile-${await identity}-${remoteSessionId}`;
}

async function loadIdentity(): Promise<string> {
	const store = await import("expo-secure-store");
	const existing = await store.getItemAsync(STORAGE_KEY);
	if (existing) return existing;
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	const value = Array.from(bytes, (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	// Fail closed if storage is unavailable: an ephemeral fallback would orphan
	// every newly created question executor again on the next app launch.
	await store.setItemAsync(STORAGE_KEY, value);
	return value;
}
