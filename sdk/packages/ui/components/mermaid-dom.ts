import type { MermaidConfig } from "mermaid";
import {
	buildMermaidConfig,
	cssColorToHex,
	encodePngWithinLimit,
	FALLBACK_MERMAID_TOKENS,
	type MermaidColorMode,
	type MermaidThemeTokens,
	normalizeMermaidTokens,
	prepareSvgForRaster,
	resolveMermaidFontFamily,
	resolvePngDesiredScale,
} from "./mermaid-diagram.js";

/**
 * Browser-only glue for the owned Mermaid block: samples the live Cline design
 * tokens (oklch CSS custom properties) as concrete sRGB, watches for light/dark
 * and accent changes, and rasterizes/saves diagrams. All entry points are safe
 * to import in Node; DOM access happens only inside the functions.
 */

// Custom property backing each Mermaid theme token.
const TOKEN_VARIABLES = {
	background: "--card",
	border: "--border",
	error: "--destructive",
	foreground: "--foreground",
	muted: "--muted",
	mutedForeground: "--muted-foreground",
	primary: "--primary",
} satisfies Record<keyof MermaidThemeTokens, string>;

const FONT_VARIABLE = "--font-sans";

// Attributes that change the resolved tokens: `.dark` (@cline/ui theme),
// the desktop theme/accent data attributes, and inline style overrides.
const THEME_ATTRIBUTES = [
	"class",
	"data-cline-accent",
	"data-cline-hub-theme",
	"data-theme",
	"style",
];

export interface ResolvedMermaidTheme {
	/** Font stack from the `--font-sans` token, with a system fallback. */
	fontFamily: string;
	/** Stable signature; changes only when the rendered theme would change. */
	key: string;
	mode: MermaidColorMode;
	tokens: MermaidThemeTokens;
}

export function detectColorMode(root?: Element): MermaidColorMode {
	if (typeof document === "undefined") return "light";
	const html = document.documentElement;
	const scope = root ?? html;
	if (scope.closest(".dark") || html.classList.contains("dark")) return "dark";
	const declared =
		html.getAttribute("data-cline-hub-theme") ?? html.dataset.theme;
	return declared === "dark" ? "dark" : "light";
}

let scratchContext: CanvasRenderingContext2D | null | undefined;

/** Canvas fallback for color syntaxes the pure parser doesn't cover. */
function canvasColorToHex(value: string): string | null {
	if (typeof document === "undefined") return null;
	if (scratchContext === undefined) {
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		scratchContext = canvas.getContext("2d", { willReadFrequently: true });
	}
	const context = scratchContext;
	if (!context) return null;
	// An invalid assignment is ignored, leaving the sentinel in place.
	context.fillStyle = "#010203";
	context.fillStyle = value;
	if (context.fillStyle === "#010203" && cssColorToHex(value) === null) {
		return null;
	}
	context.clearRect(0, 0, 1, 1);
	context.fillRect(0, 0, 1, 1);
	const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
	if (a === 0) return null;
	const channel = (n: number) => n.toString(16).padStart(2, "0");
	return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function resolveTokenColor(style: CSSStyleDeclaration, name: string): string {
	const raw = style.getPropertyValue(name).trim();
	if (!raw) return "";
	return cssColorToHex(raw) ?? canvasColorToHex(raw) ?? "";
}

/**
 * Reads the design tokens in effect at `element` (so scoped-token embeds and
 * accent overrides are honored) and resolves them to `#rrggbb`. Tokens that
 * cannot be resolved fall back to the palette for the detected mode.
 */
export function readMermaidTheme(element?: Element): ResolvedMermaidTheme {
	if (typeof document === "undefined") {
		const tokens = FALLBACK_MERMAID_TOKENS.light;
		const fontFamily = resolveMermaidFontFamily(undefined);
		return {
			fontFamily,
			key: JSON.stringify(["light", tokens, fontFamily]),
			mode: "light",
			tokens,
		};
	}
	const target = element ?? document.documentElement;
	const mode = detectColorMode(target);
	const style = getComputedStyle(target);
	const resolve = (name: string) => resolveTokenColor(style, name);
	// Explicit per-key reads keep the result typed without a key cast; an empty
	// string means "unresolved" and is replaced by the palette in normalize.
	const raw: MermaidThemeTokens = {
		background: resolve(TOKEN_VARIABLES.background),
		border: resolve(TOKEN_VARIABLES.border),
		error: resolve(TOKEN_VARIABLES.error),
		foreground: resolve(TOKEN_VARIABLES.foreground),
		muted: resolve(TOKEN_VARIABLES.muted),
		mutedForeground: resolve(TOKEN_VARIABLES.mutedForeground),
		primary: resolve(TOKEN_VARIABLES.primary),
	};
	const tokens = normalizeMermaidTokens(raw, mode);
	const fontFamily = resolveMermaidFontFamily(
		style.getPropertyValue(FONT_VARIABLE),
	);
	return {
		fontFamily,
		key: JSON.stringify([mode, tokens, fontFamily]),
		mode,
		tokens,
	};
}

/** Themed Mermaid config for the tokens currently in effect. */
export function resolveThemedMermaidConfig(element?: Element): MermaidConfig {
	const { fontFamily, mode, tokens } = readMermaidTheme(element);
	return buildMermaidConfig(tokens, mode, { fontFamily });
}

/**
 * Calls `onChange` when light/dark, the accent palette, or inline token
 * overrides change on the document root. Returns a cleanup function.
 */
export function observeThemeChanges(onChange: () => void): () => void {
	if (
		typeof MutationObserver === "undefined" ||
		typeof document === "undefined"
	) {
		return () => {};
	}
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, {
		attributeFilter: THEME_ATTRIBUTES,
		attributes: true,
	});
	return () => observer.disconnect();
}

const FONT_WAIT_MS = 1500;

/**
 * Waits (bounded) for web fonts so Mermaid measures text with Inter rather
 * than a fallback face. Never rejects and never blocks longer than 1.5s.
 */
export async function waitForFonts(): Promise<void> {
	if (typeof document === "undefined" || !document.fonts) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, FONT_WAIT_MS);
	});
	try {
		await Promise.race([document.fonts.ready.then(() => undefined), timeout]);
	} catch {
		// A failed font wait must not block rendering.
	} finally {
		clearTimeout(timer);
	}
}

function svgToDataUrl(svg: string): string {
	const bytes = new TextEncoder().encode(svg);
	let binary = "";
	const chunk = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunk) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
	}
	return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function loadImage(
	src: string,
	width: number,
	height: number,
): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image(width, height);
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Failed to load diagram image"));
		image.src = src;
	});
}

/**
 * Rasterizes a Mermaid SVG to an opaque PNG filled with `background`. Loads the
 * SVG as a data: URL (as Streamdown's exporter does; no object URL to revoke and
 * no canvas taint from blob: origins), sizes the canvas at 2x-3x (following the
 * device pixel ratio) with the longest edge capped (see `computePngExportSize`),
 * and waits for fonts first.
 */
export async function svgToPngBlob(
	svg: string,
	background: string,
): Promise<Blob> {
	await waitForFonts();
	const prepared = prepareSvgForRaster(svg);
	const image = await loadImage(
		svgToDataUrl(prepared.svg),
		prepared.width,
		prepared.height,
	);
	// Oversize results (dense diagrams) are re-encoded at a lower scale so the
	// PNG stays under the ~5 MiB attachment limit.
	return encodePngWithinLimit(
		prepared,
		(size) => encodeCanvasPng(image, size, background),
		resolvePngDesiredScale(
			typeof window === "undefined" ? undefined : window.devicePixelRatio,
		),
	);
}

function encodeCanvasPng(
	image: HTMLImageElement,
	size: { height: number; width: number },
	background: string,
): Promise<Blob> {
	const canvas = document.createElement("canvas");
	canvas.width = size.width;
	canvas.height = size.height;
	const context = canvas.getContext("2d");
	if (!context) return Promise.reject(new Error("Canvas is unavailable"));
	// Opaque themed surface, never transparent: pasted into a light or dark
	// composer the diagram keeps a readable background.
	context.fillStyle = background;
	context.fillRect(0, 0, size.width, size.height);
	context.drawImage(image, 0, 0, size.width, size.height);
	return new Promise<Blob>((resolve, reject) => {
		try {
			canvas.toBlob((blob) => {
				if (blob) resolve(blob);
				else reject(new Error("Failed to encode PNG"));
			}, "image/png");
		} catch (error) {
			reject(error);
		}
	});
}

const REVOKE_DELAY_MS = 1000;

/**
 * Anchor+blob download (same mechanism as Streamdown's built-in exports). The
 * object URL is revoked shortly after the click: revoking synchronously can
 * cancel the download in WebKit.
 */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	try {
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		document.body.removeChild(anchor);
	} finally {
		setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
	}
}

export function downloadText(text: string, filename: string): void {
	downloadBlob(
		new Blob([text], { type: "text/plain;charset=utf-8" }),
		filename,
	);
}

/**
 * Mermaid renders into a temporary `#d<id>` container in <body>. It removes it
 * on success; this makes sure a failed render never leaves one behind. Only the
 * container is removed: the SVG's own `#<id>` may already live in our tree.
 */
export function cleanupMermaidArtifacts(id: string): void {
	if (typeof document === "undefined") return;
	document.getElementById(`d${id}`)?.remove();
}
