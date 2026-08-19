/**
 * Release-channel detection for the desktop app.
 *
 * Beta builds are cut from the desktop-experimental branch with prerelease
 * versions (e.g. 0.0.14-beta.1), so the version string is the single source
 * of truth for the channel: it is baked into package.json/tauri.conf.json at
 * build time and reported by the sidecar's get_process_context, which works
 * in both the Tauri shell and web dev mode (where no Tauri API exists).
 * See apps/examples/desktop-app/EXPERIMENTAL.md for the channel model.
 */

export const STABLE_PRODUCT_NAME = "Cline Code";
export const BETA_PRODUCT_NAME = "Cline Code Beta";

export function isBetaVersion(version: string | null | undefined): boolean {
	return typeof version === "string" && version.includes("-beta");
}

export function productNameForVersion(
	version: string | null | undefined,
): string {
	return isBetaVersion(version) ? BETA_PRODUCT_NAME : STABLE_PRODUCT_NAME;
}
