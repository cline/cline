export const APP_FONT_SIZE_STORAGE_KEY = "cline.code.font-size.v1";

export const APP_FONT_SIZES = [12, 13, 14, 15, 16, 17, 18, 19, 20] as const;

export type AppFontSize = (typeof APP_FONT_SIZES)[number];

export const DEFAULT_APP_FONT_SIZE: AppFontSize = 15;
export const MIN_APP_FONT_SIZE: AppFontSize = APP_FONT_SIZES[0];
export const MAX_APP_FONT_SIZE: AppFontSize =
	APP_FONT_SIZES[APP_FONT_SIZES.length - 1];

export function isAppFontSize(value: unknown): value is AppFontSize {
	return (
		typeof value === "number" &&
		(APP_FONT_SIZES as readonly number[]).includes(value)
	);
}

function parseAppFontSize(value: string | null): AppFontSize | null {
	if (value === null || value.trim() === "") {
		return null;
	}
	const parsed = Number(value);
	return isAppFontSize(parsed) ? parsed : null;
}

/**
 * Runs from the document head before the webview paints. Keep this
 * self-contained: the browser executes it before the client bundle loads.
 */
export const APP_FONT_SIZE_BOOTSTRAP_SCRIPT = `(() => {
	const root = document.documentElement;
	let fontSize = ${JSON.stringify(DEFAULT_APP_FONT_SIZE)};

	try {
		const stored = window.localStorage.getItem(${JSON.stringify(APP_FONT_SIZE_STORAGE_KEY)});
		const parsed = Number(stored);
		if (
			stored !== null &&
			stored.trim() !== "" &&
			Number.isInteger(parsed) &&
			parsed >= ${JSON.stringify(MIN_APP_FONT_SIZE)} &&
			parsed <= ${JSON.stringify(MAX_APP_FONT_SIZE)}
		) {
			fontSize = parsed;
		}
	} catch {}

	root.style.fontSize = fontSize + "px";
	root.dataset.clineFontSize = String(fontSize);
})();`;

export function readStoredAppFontSize(): AppFontSize {
	try {
		return (
			parseAppFontSize(
				window.localStorage.getItem(APP_FONT_SIZE_STORAGE_KEY),
			) ?? DEFAULT_APP_FONT_SIZE
		);
	} catch {
		return DEFAULT_APP_FONT_SIZE;
	}
}

export function applyAppFontSize(fontSize: AppFontSize): AppFontSize {
	document.documentElement.style.fontSize = `${fontSize}px`;
	document.documentElement.dataset.clineFontSize = String(fontSize);
	return fontSize;
}

export function syncAppFontSize(): AppFontSize {
	return applyAppFontSize(readStoredAppFontSize());
}

export function setStoredAppFontSize(fontSize: AppFontSize): AppFontSize {
	try {
		window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, String(fontSize));
	} catch {
		// Applying still works for this session when persistence is unavailable.
	}
	return applyAppFontSize(fontSize);
}
