import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { LoadedSessionReplay } from "../session/replay";
import { getInitialThemeId, ThemeProvider } from "./hooks/theme-provider";
import { TerminalColorsContext } from "./hooks/use-theme";
import { disableOpenTuiGraphicsProbe } from "./opentui-env";
import { installTuiStdioCapture } from "./stdio-capture";
import { resolveTheme } from "./themes";
import { ReplayView } from "./views/replay-view";

/** Renders a replay full-screen and resolves once the user quits. */
export async function renderReplayTui(props: {
	replay: LoadedSessionReplay;
	speed: number;
	step: boolean;
}): Promise<void> {
	disableOpenTuiGraphicsProbe();
	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
		autoFocus: false,
	});
	const restoreStdio = installTuiStdioCapture();
	const palette = await renderer.getPalette({ timeout: 150 }).catch(() => null);
	const terminalColors = {
		background: palette?.defaultBackground ?? null,
		foreground: palette?.defaultForeground ?? null,
	};
	const initialThemeId = getInitialThemeId();
	const initialTheme = resolveTheme(initialThemeId, terminalColors);
	if (initialTheme.appBackground) {
		renderer.setBackgroundColor(initialTheme.appBackground);
	}

	await new Promise<void>((resolve, reject) => {
		let root: ReturnType<typeof createRoot> | undefined;
		let unmounted = false;
		const unmount = () => {
			if (!unmounted) {
				unmounted = true;
				root?.unmount();
			}
		};
		renderer.on("destroy", () => {
			unmount();
			restoreStdio();
			resolve();
		});
		const exit = () => {
			unmount();
			queueMicrotask(() => {
				if (!renderer.isDestroyed) {
					renderer.destroy();
				}
			});
		};
		try {
			root = createRoot(renderer);
			root.render(
				<TerminalColorsContext value={terminalColors}>
					<ThemeProvider initialThemeId={initialThemeId}>
						<ReplayView
							replay={props.replay}
							speed={props.speed}
							step={props.step}
							onExit={exit}
						/>
					</ThemeProvider>
				</TerminalColorsContext>,
			);
		} catch (error) {
			reject(error);
			unmount();
			renderer.destroy();
		}
	});
}
