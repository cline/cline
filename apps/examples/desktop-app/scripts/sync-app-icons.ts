import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { APP_ICON_IDS } from "../webview/lib/app-icon-manifest";

// Keep the web picker/favicon assets derived from the Dock icon resources.
// Oversized native assets are reduced for the web bundle; pass --check to
// report drift without changing the filesystem.
const APP_ROOT = path.resolve(import.meta.dir, "..");
const dockIconsDirectory = path.join(APP_ROOT, "src-tauri", "icons", "dock");
const webIconsDirectory = path.join(APP_ROOT, "webview", "public", "app-icons");
const nativeSourcePath = path.join(APP_ROOT, "src-tauri", "src", "main.rs");
const checkOnly = process.argv.includes("--check");
const WEB_ICON_MAX_SIZE = 256;

async function createWebPreview(sourcePath: string): Promise<Buffer> {
	const source = readFileSync(sourcePath);
	const metadata = await sharp(source).metadata();
	if (!metadata.width || !metadata.height) {
		throw new Error(`could not read image dimensions: ${sourcePath}`);
	}
	if (
		metadata.width <= WEB_ICON_MAX_SIZE &&
		metadata.height <= WEB_ICON_MAX_SIZE
	) {
		return source;
	}
	return sharp(source)
		.resize({
			fit: "inside",
			height: WEB_ICON_MAX_SIZE,
			width: WEB_ICON_MAX_SIZE,
			withoutEnlargement: true,
		})
		.png({ adaptiveFiltering: true, compressionLevel: 9, effort: 10 })
		.toBuffer();
}

async function main(): Promise<void> {
	if (!checkOnly) mkdirSync(webIconsDirectory, { recursive: true });

	const problems: string[] = [];
	const activeIconIds = new Set<string>(APP_ICON_IDS);
	const dockIconIds = readdirSync(dockIconsDirectory)
		.filter((file) => file.endsWith(".png"))
		.map((file) => path.basename(file, ".png"))
		.sort();
	const unexpectedDockIcons = dockIconIds.filter(
		(icon) => !activeIconIds.has(icon),
	);
	if (unexpectedDockIcons.length > 0) {
		problems.push(
			`unexpected Dock resources: ${unexpectedDockIcons.join(", ")}`,
		);
	}

	const nativeSource = readFileSync(nativeSourcePath, "utf8");
	const nativeList = nativeSource.match(
		/const APP_DOCK_ICONS: \[&str; \d+\] = \[([^\]]*)\];/,
	);
	const nativeIconIds = nativeList
		? [...nativeList[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
		: [];
	if (JSON.stringify(nativeIconIds) !== JSON.stringify(APP_ICON_IDS)) {
		problems.push(
			`native allowlist is ${nativeIconIds.join(", ") || "missing"}; expected ${APP_ICON_IDS.join(", ")}`,
		);
	}

	for (const icon of APP_ICON_IDS) {
		const source = path.join(dockIconsDirectory, `${icon}.png`);
		const destination = path.join(webIconsDirectory, `${icon}.png`);
		const preview = await createWebPreview(source);

		if (checkOnly) {
			let matches = false;
			try {
				matches = preview.equals(readFileSync(destination));
			} catch {
				// Report missing or unreadable assets through the same stale-icon error.
			}
			if (!matches) problems.push(`stale or missing preview: ${icon}`);
			continue;
		}

		writeFileSync(destination, preview);
	}

	if (existsSync(webIconsDirectory)) {
		for (const previewFile of readdirSync(webIconsDirectory)) {
			if (!previewFile.endsWith(".png")) continue;
			const icon = path.basename(previewFile, ".png");
			if (activeIconIds.has(icon)) continue;
			if (checkOnly) {
				problems.push(`unexpected preview: ${icon}`);
			} else {
				rmSync(path.join(webIconsDirectory, previewFile));
			}
		}
	}

	if (problems.length > 0) {
		throw new Error(
			`App icon assets are out of sync: ${problems.join("; ")}. Update the manifest/native allowlist or run bun run sync:app-icons.`,
		);
	}

	console.log(
		checkOnly
			? "App icon previews match generated Dock previews."
			: "Synced optimized app icon previews from src-tauri/icons/dock.",
	);
}

void main();
