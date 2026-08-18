import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import path from "node:path";

// Keep the web picker/favicon assets byte-for-byte aligned with the Dock icon
// resources, which are the source of truth. Pass --check in CI to report drift
// without copying or removing any files.
const APP_ICON_IDS = ["classic", "hologram", "steel", "midnight"] as const;
const RETIRED_APP_ICON_IDS = ["sunrise"] as const;
const APP_ROOT = path.resolve(import.meta.dir, "..");
const dockIconsDirectory = path.join(APP_ROOT, "src-tauri", "icons", "dock");
const webIconsDirectory = path.join(APP_ROOT, "webview", "public", "app-icons");
const checkOnly = process.argv.includes("--check");

mkdirSync(webIconsDirectory, { recursive: true });

const staleIcons: string[] = [];
for (const icon of APP_ICON_IDS) {
	const source = path.join(dockIconsDirectory, `${icon}.png`);
	const destination = path.join(webIconsDirectory, `${icon}.png`);

	if (checkOnly) {
		let matches = false;
		try {
			matches = readFileSync(source).equals(readFileSync(destination));
		} catch {
			// Report missing or unreadable assets through the same stale-icon error.
		}
		if (!matches) staleIcons.push(icon);
		continue;
	}

	copyFileSync(source, destination);
}

for (const icon of RETIRED_APP_ICON_IDS) {
	const retiredPreview = path.join(webIconsDirectory, `${icon}.png`);
	if (checkOnly) {
		if (existsSync(retiredPreview)) staleIcons.push(icon);
	} else {
		rmSync(retiredPreview, { force: true });
	}
}

if (staleIcons.length > 0) {
	throw new Error(
		`App icon previews are out of sync: ${staleIcons.join(", ")}. Run bun run sync:app-icons.`,
	);
}

console.log(
	checkOnly
		? "App icon previews match Dock resources."
		: "Synced app icon previews from src-tauri/icons/dock.",
);
