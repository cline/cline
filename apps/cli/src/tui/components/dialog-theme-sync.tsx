import { useRenderer } from "@opentui/react";
import { DialogContainerRenderable } from "@opentui-ui/dialog";
import { useDialogState } from "@opentui-ui/dialog/react";
import { useEffect } from "react";
import { useTheme } from "../hooks/use-theme";
import { getDialogSurface } from "../themes";

/**
 * Keeps dialog panel backgrounds in sync with the active theme.
 *
 * The dialog library computes a panel's style once when the dialog opens
 * (from the container's dialogOptions), so theme changes made while a dialog
 * is open — most visibly the live preview while scrolling the theme picker —
 * would leave the panel on the old surface color. This component pushes the
 * theme's dialog surface into the container (for dialogs opened later) and
 * onto every open dialog renderable (repainting them in place).
 *
 * Must be mounted inside the DialogProvider. Re-runs when a dialog opens so
 * the first dialog after mount is covered too (the container is only added
 * to the renderer root after this component's initial effect).
 */
export function DialogThemeSync() {
	const renderer = useRenderer();
	const theme = useTheme();
	const dialogCount = useDialogState((state: { count: number }) => state.count);
	const surface = getDialogSurface(theme);

	// biome-ignore lint/correctness/useExhaustiveDependencies: dialogCount re-runs the sync when a dialog opens, covering dialogs opened before the container-level option applied (see docblock).
	useEffect(() => {
		const container = renderer.root
			.getChildren()
			.find(
				(child): child is DialogContainerRenderable =>
					child instanceof DialogContainerRenderable,
			);
		if (!container) return;
		container.dialogOptions = { style: { backgroundColor: surface } };
		for (const [, dialogRenderable] of container.getDialogRenderables()) {
			dialogRenderable.backgroundColor = surface;
		}
	}, [renderer, surface, dialogCount]);

	return null;
}
