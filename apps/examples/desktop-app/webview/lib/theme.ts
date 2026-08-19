export const HUB_THEME_STORAGE_KEY = "cline-hub-theme";

export type HubTheme = "light" | "dark";

export const DEFAULT_HUB_THEME: HubTheme = "dark";

/**
 * Runs from the document head before the webview paints. Keep this
 * self-contained: the browser executes it before the client bundle loads.
 */
export const HUB_THEME_BOOTSTRAP_SCRIPT = `(() => {
	const root = document.documentElement;
	let theme;

	try {
		const stored = window.localStorage.getItem(${JSON.stringify(HUB_THEME_STORAGE_KEY)});
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
		theme = ${JSON.stringify(DEFAULT_HUB_THEME)};
	}
	root.classList.toggle("dark", theme === "dark");
	root.dataset.clineHubTheme = theme;
})();`;

export function readStoredHubTheme(): HubTheme | null {
	try {
		const stored = window.localStorage.getItem(HUB_THEME_STORAGE_KEY);
		return stored === "light" || stored === "dark" ? stored : null;
	} catch {
		return null;
	}
}

export function readSystemHubTheme(): HubTheme {
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
	return DEFAULT_HUB_THEME;
}

export function applyHubTheme(theme: HubTheme): HubTheme {
	document.documentElement.classList.toggle("dark", theme === "dark");
	document.documentElement.dataset.clineHubTheme = theme;
	return theme;
}

export function syncHubTheme(): HubTheme {
	return applyHubTheme(readStoredHubTheme() ?? readSystemHubTheme());
}

export function setStoredHubTheme(theme: HubTheme): HubTheme {
	try {
		window.localStorage.setItem(HUB_THEME_STORAGE_KEY, theme);
	} catch {
		// Applying still works for this session when persistence is unavailable.
	}
	return applyHubTheme(theme);
}

export const HUB_ACCENT_STORAGE_KEY = "cline.code.accent.v1";

/**
 * Accent palettes selectable in Settings. "violet" is the built-in brand
 * accent from @cline/ui tokens; the others override the interactive tokens
 * via `[data-cline-accent]` blocks in globals.css.
 */
export const HUB_ACCENTS = [
	"violet",
	"graphite",
	"cyan",
	"pink",
	"espresso",
	"ember",
] as const;

export type HubAccent = (typeof HUB_ACCENTS)[number];

export const DEFAULT_HUB_ACCENT: HubAccent = "violet";

export function isHubAccent(value: unknown): value is HubAccent {
	return (
		typeof value === "string" &&
		(HUB_ACCENTS as readonly string[]).includes(value)
	);
}

export function readStoredHubAccent(): HubAccent {
	try {
		const stored = window.localStorage.getItem(HUB_ACCENT_STORAGE_KEY);
		return isHubAccent(stored) ? stored : DEFAULT_HUB_ACCENT;
	} catch {
		return DEFAULT_HUB_ACCENT;
	}
}

export function applyHubAccent(accent: HubAccent): HubAccent {
	if (accent === DEFAULT_HUB_ACCENT) {
		delete document.documentElement.dataset.clineAccent;
	} else {
		document.documentElement.dataset.clineAccent = accent;
	}
	return accent;
}

export function syncHubAccent(): HubAccent {
	return applyHubAccent(readStoredHubAccent());
}

export function setStoredHubAccent(accent: HubAccent): HubAccent {
	try {
		window.localStorage.setItem(HUB_ACCENT_STORAGE_KEY, accent);
	} catch {
		// Accent falls back to default next launch; applying still works now.
	}
	return applyHubAccent(accent);
}

/**
 * Follow OS light/dark changes while the user has no stored preference.
 * Returns a cleanup function that removes the listener.
 */
export function watchSystemHubTheme(
	onChange?: (theme: HubTheme) => void,
): () => void {
	const media = window.matchMedia?.("(prefers-color-scheme: dark)");
	if (!media) {
		return () => {};
	}
	const handle = () => {
		if (readStoredHubTheme() !== null) {
			return;
		}
		onChange?.(applyHubTheme(readSystemHubTheme()));
	};
	media.addEventListener("change", handle);
	return () => media.removeEventListener("change", handle);
}
