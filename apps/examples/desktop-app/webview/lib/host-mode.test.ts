// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
	getHostCapabilities,
	getHostMode,
	hostCapabilitiesFor,
	resetHostModeForTesting,
} from "./host-mode";

const win = window as unknown as Record<string, unknown>;

afterEach(() => {
	delete win.__CLINE_HOST_SHELL__;
	delete win.__TAURI_INTERNALS__;
	delete document.documentElement.dataset.clineHost;
	resetHostModeForTesting();
});

describe("getHostMode", () => {
	it("defaults to web", () => {
		expect(getHostMode()).toBe("web");
		expect(document.documentElement.dataset.clineHost).toBe("web");
	});

	it("detects the Tauri desktop shell", () => {
		win.__TAURI_INTERNALS__ = {};
		expect(getHostMode()).toBe("desktop");
	});

	it("prefers an installed host shell over Tauri", () => {
		win.__TAURI_INTERNALS__ = {};
		win.__CLINE_HOST_SHELL__ = { kind: "vscode", commands: [] };
		expect(getHostMode()).toBe("vscode");
		expect(document.documentElement.dataset.clineHost).toBe("vscode");
	});

	it("caches the first detection", () => {
		expect(getHostMode()).toBe("web");
		win.__CLINE_HOST_SHELL__ = { kind: "vscode", commands: [] };
		expect(getHostMode()).toBe("web");
	});
});

describe("hostCapabilitiesFor", () => {
	it("gives the desktop everything it owns natively", () => {
		const caps = hostCapabilitiesFor("desktop");
		expect(caps).toMatchObject({
			canQuit: true,
			hasIntegratedTerminal: true,
			hasFileBrowser: true,
			opensDiffsExternally: false,
			ownsTheme: false,
			ownsKeybindings: false,
			hasAppIcon: true,
			hasAutoUpdate: true,
		});
	});

	it("defers to the editor inside VS Code", () => {
		const caps = hostCapabilitiesFor("vscode");
		expect(caps).toMatchObject({
			canQuit: false,
			hasIntegratedTerminal: false,
			hasFileBrowser: false,
			opensDiffsExternally: true,
			ownsTheme: true,
			ownsFontSize: true,
			ownsKeybindings: true,
			hasAppIcon: false,
			hasAutoUpdate: false,
			ownsWorkspace: true,
			compactLayout: true,
		});
	});

	it("returns a stable object per mode", () => {
		win.__CLINE_HOST_SHELL__ = { kind: "vscode", commands: [] };
		expect(getHostCapabilities()).toBe(getHostCapabilities());
	});
});
