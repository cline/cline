import { createContext, useContext } from "react";

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
