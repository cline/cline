import { createContext, useContext } from "react";
import { getTerminalTheme, type TerminalTheme } from "../palette";

export interface TerminalColors {
	background: string | null;
	foreground: string | null;
}

export const TerminalColorsContext = createContext<TerminalColors>({
	background: null,
	foreground: null,
});

export function useTerminalBackground(): string | null {
	return useContext(TerminalColorsContext).background;
}

export function useTerminalForeground(): string | null {
	return useContext(TerminalColorsContext).foreground;
}

export function useTerminalTheme(): TerminalTheme {
	const { background, foreground } = useContext(TerminalColorsContext);
	return getTerminalTheme(background, foreground);
}
