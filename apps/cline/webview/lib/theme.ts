export const APP_THEME_STORAGE_KEY = "cline-app-theme";

export type AppTheme = "light" | "dark";

export const DEFAULT_APP_THEME: AppTheme = "dark";

/**
 * Runs from the document head before the webview paints. Keep this
 * self-contained: the browser executes it before the client bundle loads.
 */
export const APP_THEME_BOOTSTRAP_SCRIPT = `(() => {
	const root = document.documentElement;
	let theme;

	try {
		const stored = window.localStorage.getItem(${JSON.stringify(APP_THEME_STORAGE_KEY)});
		if (stored === "light" || stored === "dark") {
			theme = stored;
		}
	} catch {}

	if (!theme) {
		try {
			if (typeof window.matchMedia === "function") {
				if (window.matchMedia("(prefers-color-scheme: light)").matches) {
					theme = "light";
				} else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
					theme = "dark";
				}
			}
		} catch {}
	}

	if (!theme) {
		theme = ${JSON.stringify(DEFAULT_APP_THEME)};
	}
	root.classList.toggle("dark", theme === "dark");
	root.dataset.clineAppTheme = theme;
})();`;

export function readStoredAppTheme(): AppTheme | null {
	try {
		const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
		return stored === "light" || stored === "dark" ? stored : null;
	} catch {
		return null;
	}
}

export function readSystemAppTheme(): AppTheme {
	const kind = document.body.dataset.vscodeThemeKind;
	if (kind === "vscode-dark" || kind === "vscode-high-contrast") {
		return "dark";
	}
	if (kind === "vscode-light" || kind === "vscode-high-contrast-light") {
		return "light";
	}
	try {
		if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
			return "dark";
		}
		if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
			return "light";
		}
	} catch {
		// Use the app default when the host cannot expose its color scheme.
	}
	return DEFAULT_APP_THEME;
}

export function applyAppTheme(theme: AppTheme): AppTheme {
	document.documentElement.classList.toggle("dark", theme === "dark");
	document.documentElement.dataset.clineAppTheme = theme;
	return theme;
}

export function syncAppTheme(): AppTheme {
	return applyAppTheme(readStoredAppTheme() ?? readSystemAppTheme());
}

export function setStoredAppTheme(theme: AppTheme): AppTheme {
	try {
		window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
	} catch {
		// Applying still works for this session when persistence is unavailable.
	}
	return applyAppTheme(theme);
}

export const APP_ACCENT_STORAGE_KEY = "cline.code.accent.v1";

/**
 * Accent palettes selectable in Settings. "violet" is the built-in brand
 * accent from @cline/ui tokens; the others override the interactive tokens
 * via `[data-cline-accent]` blocks in globals.css.
 */
export const APP_ACCENTS = [
	"violet",
	"graphite",
	"cyan",
	"pink",
	"espresso",
	"ember",
] as const;

export type AppAccent = (typeof APP_ACCENTS)[number];

export const DEFAULT_APP_ACCENT: AppAccent = "violet";

export function isAppAccent(value: unknown): value is AppAccent {
	return (
		typeof value === "string" &&
		(APP_ACCENTS as readonly string[]).includes(value)
	);
}

export function readStoredAppAccent(): AppAccent {
	try {
		const stored = window.localStorage.getItem(APP_ACCENT_STORAGE_KEY);
		return isAppAccent(stored) ? stored : DEFAULT_APP_ACCENT;
	} catch {
		return DEFAULT_APP_ACCENT;
	}
}

export function applyAppAccent(accent: AppAccent): AppAccent {
	if (accent === DEFAULT_APP_ACCENT) {
		delete document.documentElement.dataset.clineAccent;
	} else {
		document.documentElement.dataset.clineAccent = accent;
	}
	return accent;
}

export function syncAppAccent(): AppAccent {
	return applyAppAccent(readStoredAppAccent());
}

export function setStoredAppAccent(accent: AppAccent): AppAccent {
	try {
		window.localStorage.setItem(APP_ACCENT_STORAGE_KEY, accent);
	} catch {
		// Accent falls back to default next launch; applying still works now.
	}
	return applyAppAccent(accent);
}

/**
 * Follow OS light/dark changes while the user has no stored preference.
 * Returns a cleanup function that removes the listener.
 */
export function watchSystemAppTheme(
	onChange?: (theme: AppTheme) => void,
): () => void {
	const media = window.matchMedia?.("(prefers-color-scheme: dark)");
	if (!media) {
		return () => {};
	}
	const handle = () => {
		if (readStoredAppTheme() !== null) {
			return;
		}
		onChange?.(applyAppTheme(readSystemAppTheme()));
	};
	media.addEventListener("change", handle);
	return () => media.removeEventListener("change", handle);
}
