import { readTuiThemeGlobally, setTuiThemeGlobally } from "@cline/core";
import { useRenderer } from "@opentui/react";
import {
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { AUTO_THEME_ID, normalizeThemeId, resolveTheme } from "../themes";
import { TerminalColorsContext, ThemeContext } from "./use-theme";

/**
 * Resolves the theme to boot with: CLINE_THEME env override first, then the
 * persisted setting, falling back to terminal auto-detection.
 */
export function getInitialThemeId(): string {
	const fromEnv = process.env.CLINE_THEME?.trim();
	if (fromEnv) {
		return normalizeThemeId(fromEnv);
	}
	try {
		return normalizeThemeId(readTuiThemeGlobally());
	} catch {
		return AUTO_THEME_ID;
	}
}

export function ThemeProvider(props: {
	initialThemeId?: string;
	children: ReactNode;
}) {
	const detected = useContext(TerminalColorsContext);
	const renderer = useRenderer();
	const [selectedThemeId, setSelectedThemeId] = useState(() =>
		normalizeThemeId(props.initialThemeId ?? getInitialThemeId()),
	);
	const [previewId, setPreviewId] = useState<string | null>(null);

	const activeThemeId = previewId ?? selectedThemeId;
	const theme = useMemo(
		() => resolveTheme(activeThemeId, detected),
		[activeThemeId, detected],
	);

	useEffect(() => {
		if (renderer.isDestroyed) {
			return;
		}
		renderer.setBackgroundColor(theme.appBackground ?? "transparent");
	}, [renderer, theme.appBackground]);

	const setThemeId = useCallback((id: string) => {
		const normalized = normalizeThemeId(id);
		setSelectedThemeId(normalized);
		setPreviewId(null);
		try {
			setTuiThemeGlobally(normalized);
		} catch {
			// Persisting is best-effort; the in-session theme still applies.
		}
	}, []);

	const previewThemeId = useCallback((id: string | null) => {
		setPreviewId(id === null ? null : normalizeThemeId(id));
	}, []);

	const value = useMemo(
		() => ({ theme, selectedThemeId, setThemeId, previewThemeId }),
		[theme, selectedThemeId, setThemeId, previewThemeId],
	);

	return <ThemeContext value={value}>{props.children}</ThemeContext>;
}
