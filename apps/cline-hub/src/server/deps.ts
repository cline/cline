import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ProviderSettingsManager } from "@cline/core";
import {
	buildDashboardLaunchUrl,
	resolveClineHubServerOptions,
} from "../options";
import type { BrowserConfig } from "./types";

export const options = resolveClineHubServerOptions();
export const {
	dashboardWebUrl,
	host,
	port,
	publicUrl,
	roomSecret,
	workspaceRoot,
} = options;
export const inviteUrl = buildDashboardLaunchUrl(
	dashboardWebUrl,
	publicUrl,
	roomSecret,
);

const serverDir = dirname(fileURLToPath(import.meta.url));
/** server.ts lives one level up from this module, so resolve relative to it. */
export const appSrcDir = join(serverDir, "..");
export const webviewDistDir =
	process.env.CLINE_HUB_WEBVIEW_DIST_DIR?.trim() ||
	join(appSrcDir, "../dist/webview");
export const cliIndexPath = normalize(
	join(appSrcDir, "../../cli/src/index.ts"),
);

export const providerSettingsManager = new ProviderSettingsManager();

export const browserConfig: BrowserConfig = {
	bridgeUrl: publicUrl,
	dashboardWebUrl,
	inviteRequired: Boolean(roomSecret),
	publicUrl,
};
