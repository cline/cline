import { fileURLToPath } from "node:url";

/** Shared assets distributed with this SDK, independent of any host app. */
export const AVATAR_ROOT = fileURLToPath(
	new URL("../assets/avatars/", import.meta.url),
);
export const FIRMWARE_ROOT = fileURLToPath(
	new URL("../firmware/", import.meta.url),
);
