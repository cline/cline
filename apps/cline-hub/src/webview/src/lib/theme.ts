export const HUB_THEME_STORAGE_KEY = "cline-hub-theme";

export type HubTheme = "light" | "dark";

export function readStoredHubTheme(): HubTheme | null {
	const stored = window.localStorage.getItem(HUB_THEME_STORAGE_KEY);
	return stored === "light" || stored === "dark" ? stored : null;
}

export function readSystemHubTheme(): HubTheme {
	const kind = document.body.dataset.vscodeThemeKind;
	if (kind === "vscode-dark" || kind === "vscode-high-contrast") {
		return "dark";
	}
	if (kind === "vscode-light" || kind === "vscode-high-contrast-light") {
		return "light";
	}
	return window.matchMedia?.("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
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
	window.localStorage.setItem(HUB_THEME_STORAGE_KEY, theme);
	return applyHubTheme(theme);
}

/** Follow browser color-scheme changes until the user saves a preference. */
export function watchSystemHubTheme(): () => void {
	const media = window.matchMedia?.("(prefers-color-scheme: dark)");
	if (!media) return () => {};
	const handle = () => {
		if (readStoredHubTheme() === null) syncHubTheme();
	};
	media.addEventListener("change", handle);
	return () => media.removeEventListener("change", handle);
}
