import { createContext, useContext } from "react";
import type { TerminalTheme } from "../palette";
import { AUTO_THEME_ID, type ResolvedTheme, resolveTheme } from "../themes";

export interface TerminalColors {
	background: string | null;
	foreground: string | null;
}

export const TerminalColorsContext = createContext<TerminalColors>({
	background: null,
	foreground: null,
});

export interface ThemeController {
	theme: ResolvedTheme;
	/** The persisted selection (previews do not change this). */
	selectedThemeId: string;
	/** Select and persist a theme. */
	setThemeId: (id: string) => void;
	/** Temporarily render a theme (live preview); null reverts to selection. */
	previewThemeId: (id: string | null) => void;
}

/** Provided by ThemeProvider (see theme-provider.tsx). */
export const ThemeContext = createContext<ThemeController | null>(null);

export function useThemeController(): ThemeController {
	const controller = useContext(ThemeContext);
	if (!controller) {
		throw new Error("useThemeController must be used within ThemeProvider");
	}
	return controller;
}

export function useTheme(): ResolvedTheme {
	const controller = useContext(ThemeContext);
	const detected = useContext(TerminalColorsContext);
	// Fall back to auto resolution so components render sensibly when mounted
	// without a ThemeProvider (e.g. in isolated tests).
	return controller?.theme ?? resolveTheme(AUTO_THEME_ID, detected);
}

/**
 * Background that adaptive colors (input field, user bubbles, rules) derive
 * from: the theme's painted background when set, else the detected one.
 */
export function useTerminalBackground(): string | null {
	return useTheme().background;
}

export function useTerminalForeground(): string | null {
	return useContext(TerminalColorsContext).foreground;
}

export function useTerminalTheme(): TerminalTheme {
	return useTheme().variant;
}
