import { createContext, type ReactNode, useContext } from "react";
import { darkTheme, type Theme } from "./theme";

// Standalone components and render tests retain the established dark default.
const ThemeContext = createContext<Theme>(darkTheme);

export function ThemeProvider({
	value = darkTheme,
	children,
}: {
	value?: Theme;
	children: ReactNode;
}) {
	return (
		<ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
	);
}

/** Access the active theme (structural tokens + violet brand + type scale). */
export function useTheme(): Theme {
	return useContext(ThemeContext);
}
