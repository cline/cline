import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { getInitialThemeId } from "./hooks/theme-provider";
import { Root } from "./root";
import { installTuiStdioCapture } from "./stdio-capture";
import { resolveTheme } from "./themes";
import type { TuiProps } from "./types";

export type { TuiProps } from "./types";

export async function renderOpenTui(
	props: TuiProps,
): Promise<{ destroy: () => void; waitUntilExit: () => Promise<void> }> {
	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
		autoFocus: false,
		enableMouseMovement: true,
	});
	const restoreStdio = installTuiStdioCapture();

	const detectedPalette = await renderer
		.getPalette({ timeout: 150 })
		.catch(() => null);
	const terminalBackground = detectedPalette?.defaultBackground ?? null;
	const terminalForeground = detectedPalette?.defaultForeground ?? null;

	// Paint the selected theme's background before the first frame so themed
	// sessions don't flash the terminal's own background on startup.
	const initialThemeId = getInitialThemeId();
	const initialTheme = resolveTheme(initialThemeId, {
		background: terminalBackground,
		foreground: terminalForeground,
	});
	if (initialTheme.appBackground) {
		renderer.setBackgroundColor(initialTheme.appBackground);
	}

	let root: ReturnType<typeof createRoot>;
	try {
		root = createRoot(renderer);
		root.render(
			<Root
				{...props}
				terminalBackground={terminalBackground}
				terminalForeground={terminalForeground}
				initialThemeId={initialThemeId}
			/>,
		);
	} catch (error) {
		restoreStdio();
		renderer.destroy();
		throw error;
	}

	let resolveExit: (() => void) | undefined;
	const exitPromise = new Promise<void>((resolve) => {
		resolveExit = resolve;
	});

	let unmounted = false;
	const unmountRoot = () => {
		if (unmounted) {
			return;
		}
		unmounted = true;
		root.unmount();
	};

	renderer.on("destroy", () => {
		unmountRoot();
		restoreStdio();
		resolveExit?.();
	});

	let destroyStarted = false;
	const destroy = () => {
		if (destroyStarted) {
			return;
		}
		destroyStarted = true;
		unmountRoot();
		// Let OpenTUI finish parsing the current stdin batch before teardown.
		queueMicrotask(() => {
			// Reset the title while the native renderer is still alive; the
			// unmount cleanup in root.tsx skips it once the renderer is destroyed.
			// Re-check here: OpenTUI's own signal handlers can destroy the
			// renderer between destroy() queuing this microtask and it running
			// (e.g. an idle SIGTERM dispatches to both our handler and OpenTUI's).
			if (!renderer.isDestroyed) {
				renderer.setTerminalTitle("");
			}
			renderer.destroy();
		});
	};

	return {
		destroy,
		waitUntilExit: () => exitPromise,
	};
}
