/**
 * Centralized configuration for the Mermaid diagram block: every tunable
 * value used across `diagrams/mermaid/` and the React block lives here.
 */

export const DIAGRAM_ZOOM = {
	max: 4,
	min: 0.25,
	step: 1.25,
	wheelMaxDeltaY: 100,
	wheelSensitivity: 0.0025,
} as const;

export const PNG_EXPORT = {
	attemptLimit: 4,
	baseScale: 2,
	fallbackSvg: { height: 600, width: 800 },
	maxDesiredScale: 3,
	maxEdge: 4096,
	// Mirrors DEFAULT_MAX_IMAGE_ENCODED_BYTES in @cline/shared's llms/media:
	// attached images are validated against this base64-length cap.
	maxEncodedBytes: 5 * 1024 * 1024,
	retryScaleFactor: 0.7,
} as const;

export const DIAGRAM_NAMING = {
	defaultName: "diagram",
	maxDerivedSlugLength: 48,
	maxLabels: 2,
	maxSlugLength: 64,
} as const;

export const MERMAID_FONT = {
	family:
		"'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
	size: "14px",
} as const;

/** How much of each theme token is mixed into the Mermaid base-theme fills. */
export const THEME_MIX = {
	dark: {
		cluster: 0.05,
		error: 0.2,
		neutral: 0.08,
		node: 0.18,
		nodeBorder: 0.6,
		tertiary: 0.07,
	},
	light: {
		cluster: 0.03,
		error: 0.12,
		neutral: 0.05,
		node: 0.1,
		nodeBorder: 0.5,
		tertiary: 0.04,
	},
} as const;

export const UI_TIMING = {
	copiedResetMs: 1500,
	fontWaitMs: 1500,
	noticeResetMs: 4000,
	revokeUrlDelayMs: 1000,
} as const;
