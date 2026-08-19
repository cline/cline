import type { CSSProperties } from "react";

/**
 * Geometry and motion values for the welcome illustration.
 *
 * Keep layout adjustments here so the component and stylesheet stay structural.
 * Numeric values are CSS pixels unless noted otherwise.
 */
export const WELCOME_HERO_CONFIG = {
	frame: {
		width: 1200, // Maximum width of the hero canvas.
		height: 220, // Visible height and vertical pointer boundary.
		viewportGutter: 16, // Minimum space between the canvas and viewport edge.
	},
	grid: {
		height: 520, // Full height of the oversized grid mask.
		tileSize: 400, // Width and height of one repeated SVG tile.
		initialRevealX: "50%", // Horizontal focus before the pointer moves.
		initialRevealY: 280, // Vertical focus within the grid mask.
	},
	inner: {
		top: 10, // Distance from the top of the hero canvas.
		offsetX: -87, // Horizontal offset from the canvas center.
		width: 178, // Width of the bot's inner fill.
		height: 168, // Height of the bot's inner fill.
	},
	bot: {
		top: -2, // Distance from the top of the hero canvas.
		offsetX: -100, // Horizontal offset from the canvas center.
		width: 204, // Width shared by the bot fill and outline.
		height: 192, // Height shared by the bot fill and outline.
	},
	eyes: {
		top: 83, // Distance from the top of the hero canvas.
		width: 18, // Width of each eye.
		height: 52, // Height of each eye.
		leftOffsetX: -37, // Left eye offset from the canvas center.
		rightOffsetX: 19.5, // Right eye offset from the canvas center.
		travel: 6, // Maximum distance the eyes move toward the pointer.
		falloffDistance: 200, // Pointer distance needed to reach maximum travel.
		smoothing: 0.22, // Fraction of the remaining distance moved per frame.
	},
} as const;

const WELCOME_HERO_ASSETS = {
	gridMask: "/welcome-hero/grid-tile.svg",
	innerMask: "/welcome-hero/inner-mask.svg",
	botFillMask: "/welcome-hero/bot-fill-mask.svg",
	botOutlineMask: "/welcome-hero/bot-outline-mask.svg",
} as const;

export type WelcomeHeroStyle = CSSProperties & {
	"--welcome-bot-fill-mask": string;
	"--welcome-bot-height": string;
	"--welcome-bot-offset-x": string;
	"--welcome-bot-outline-mask": string;
	"--welcome-bot-top": string;
	"--welcome-bot-width": string;
	"--welcome-eye-height": string;
	"--welcome-eye-left-offset-x": string;
	"--welcome-eye-right-offset-x": string;
	"--welcome-eye-top": string;
	"--welcome-eye-width": string;
	"--welcome-eye-x": string;
	"--welcome-eye-y": string;
	"--welcome-grid-height": string;
	"--welcome-grid-initial-x": string;
	"--welcome-grid-initial-y": string;
	"--welcome-grid-mask": string;
	"--welcome-grid-tile-size": string;
	"--welcome-grid-x": string;
	"--welcome-grid-y": string;
	"--welcome-hero-height": string;
	"--welcome-hero-viewport-gutter": string;
	"--welcome-hero-width": string;
	"--welcome-inner-height": string;
	"--welcome-inner-mask": string;
	"--welcome-inner-offset-x": string;
	"--welcome-inner-top": string;
	"--welcome-inner-width": string;
};

export const WELCOME_HERO_STYLE: WelcomeHeroStyle = {
	"--welcome-bot-fill-mask": `url("${WELCOME_HERO_ASSETS.botFillMask}")`,
	"--welcome-bot-height": `${WELCOME_HERO_CONFIG.bot.height}px`,
	"--welcome-bot-offset-x": `${WELCOME_HERO_CONFIG.bot.offsetX}px`,
	"--welcome-bot-outline-mask": `url("${WELCOME_HERO_ASSETS.botOutlineMask}")`,
	"--welcome-bot-top": `${WELCOME_HERO_CONFIG.bot.top}px`,
	"--welcome-bot-width": `${WELCOME_HERO_CONFIG.bot.width}px`,
	"--welcome-eye-height": `${WELCOME_HERO_CONFIG.eyes.height}px`,
	"--welcome-eye-left-offset-x": `${WELCOME_HERO_CONFIG.eyes.leftOffsetX}px`,
	"--welcome-eye-right-offset-x": `${WELCOME_HERO_CONFIG.eyes.rightOffsetX}px`,
	"--welcome-eye-top": `${WELCOME_HERO_CONFIG.eyes.top}px`,
	"--welcome-eye-width": `${WELCOME_HERO_CONFIG.eyes.width}px`,
	"--welcome-eye-x": "0px",
	"--welcome-eye-y": "0px",
	"--welcome-grid-height": `${WELCOME_HERO_CONFIG.grid.height}px`,
	"--welcome-grid-initial-x": WELCOME_HERO_CONFIG.grid.initialRevealX,
	"--welcome-grid-initial-y": `${WELCOME_HERO_CONFIG.grid.initialRevealY}px`,
	"--welcome-grid-mask": `url("${WELCOME_HERO_ASSETS.gridMask}")`,
	"--welcome-grid-tile-size": `${WELCOME_HERO_CONFIG.grid.tileSize}px`,
	"--welcome-grid-x": WELCOME_HERO_CONFIG.grid.initialRevealX,
	"--welcome-grid-y": `${WELCOME_HERO_CONFIG.grid.initialRevealY}px`,
	"--welcome-hero-height": `${WELCOME_HERO_CONFIG.frame.height}px`,
	"--welcome-hero-viewport-gutter": `${WELCOME_HERO_CONFIG.frame.viewportGutter}px`,
	"--welcome-hero-width": `${WELCOME_HERO_CONFIG.frame.width}px`,
	"--welcome-inner-height": `${WELCOME_HERO_CONFIG.inner.height}px`,
	"--welcome-inner-mask": `url("${WELCOME_HERO_ASSETS.innerMask}")`,
	"--welcome-inner-offset-x": `${WELCOME_HERO_CONFIG.inner.offsetX}px`,
	"--welcome-inner-top": `${WELCOME_HERO_CONFIG.inner.top}px`,
	"--welcome-inner-width": `${WELCOME_HERO_CONFIG.inner.width}px`,
};
