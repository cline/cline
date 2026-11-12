"use client";

import { useId } from "react";

/*
 * Drawn in the welcome hero's bot coordinate space: the @cline/ui mascot
 * masks are 205x193 user units, rendered at 204x192 px from
 * `left: calc(50% - 100px)`, `top: -2px`, so one unit is about one pixel.
 *
 * The mascot geometry these numbers come from (agent-welcome-hero.css,
 * `--welcome-bot-outline-mask` / `--welcome-bot-fill-mask`):
 * - head body: x 22.4 to 182.05 (160 wide), corner radius about 26.8;
 * - head top band: outer edge y 32.3, inner edge y 43.95;
 * - antenna loop: outer arc x 73.4 to 131.0, top y 0; its hole runs down
 *   through the top band to y 43.95 between x 88.4 and 116.05 (the "notch").
 */
const HEAD = {
	left: 22.4,
	right: 182.05,
	centerX: 102.22,
	bandTop: 32.3,
	bandBottom: 43.95,
	antennaTop: 0,
} as const;

/** How far the brim reaches past each side of the head. */
const BRIM_OVERHANG = 12;
/** Brim top: on the forehead, well below the head's top band, so the hat is
 * worn down over the head like a helmet rather than perched like a cap. */
const BRIM_TOP = HEAD.bandBottom + 8;
/** Brim bottom: still clear of the eyes. */
const BRIM_BOTTOM = BRIM_TOP + 14;
const BRIM_RADIUS = 6;
/** Dome half width: just wider than the head, so the shell covers the head's
 * top corners. */
const DOME_HALF_WIDTH = (HEAD.right - HEAD.left) / 2 + 3;
/** Dome top: well above the antenna loop, for a tall rounded shell. */
const DOME_TOP = HEAD.antennaTop - 22;
/** Half the width of the raised crest down the middle of the dome. */
const RIDGE_HALF_WIDTH = 7;

const brimLeft = HEAD.left - BRIM_OVERHANG;
const brimRight = HEAD.right + BRIM_OVERHANG;
// The dome's base hides under the brim so no hairline gap shows between them.
const domeBase = BRIM_TOP + 1;
const domeLeft = HEAD.centerX - DOME_HALF_WIDTH;
const domeRight = HEAD.centerX + DOME_HALF_WIDTH;

export const FACTORY_HARD_HAT_GEOMETRY = {
	brim: {
		left: brimLeft,
		right: brimRight,
		top: BRIM_TOP,
		bottom: BRIM_BOTTOM,
	},
	dome: { left: domeLeft, right: domeRight, top: DOME_TOP, base: domeBase },
	head: HEAD,
} as const;

const DOME = `M${domeLeft} ${domeBase} A${DOME_HALF_WIDTH} ${domeBase - DOME_TOP} 0 0 1 ${domeRight} ${domeBase} Z`;
const BRIM = [
	`M${brimLeft + BRIM_RADIUS} ${BRIM_TOP}`,
	`H${brimRight - BRIM_RADIUS}`,
	`A${BRIM_RADIUS} ${BRIM_RADIUS} 0 0 1 ${brimRight} ${BRIM_TOP + BRIM_RADIUS}`,
	`V${BRIM_BOTTOM - BRIM_RADIUS}`,
	`A${BRIM_RADIUS} ${BRIM_RADIUS} 0 0 1 ${brimRight - BRIM_RADIUS} ${BRIM_BOTTOM}`,
	`H${brimLeft + BRIM_RADIUS}`,
	`A${BRIM_RADIUS} ${BRIM_RADIUS} 0 0 1 ${brimLeft} ${BRIM_BOTTOM - BRIM_RADIUS}`,
	`V${BRIM_TOP + BRIM_RADIUS}`,
	`A${BRIM_RADIUS} ${BRIM_RADIUS} 0 0 1 ${brimLeft + BRIM_RADIUS} ${BRIM_TOP}`,
	"Z",
].join(" ");
const RIDGE = `M${HEAD.centerX - RIDGE_HALF_WIDTH} ${domeBase} V${DOME_TOP} M${HEAD.centerX + RIDGE_HALF_WIDTH} ${domeBase} V${DOME_TOP}`;

/** Amber fill and outline: stronger than the mascot so it reads as a hard
 * hat, still translucent so it stays a watermark. */
const HAT_FILL = "fill-amber-400/40 dark:fill-amber-400/20";
const HAT_STROKE = "stroke-amber-600/80 dark:stroke-amber-400/65";

/**
 * Construction hard hat worn by the welcome hero's Cline mascot while the new
 * chat collects work for Factory. Decorative. An opaque underlay hides the
 * antenna loop and the top of the head; the shell is wider than the head and
 * the brim sits on the forehead, so the hat covers the head like a helmet.
 */
export function FactoryHardHat() {
	const clipId = useId();
	return (
		<svg
			aria-hidden="true"
			className="pointer-events-none absolute top-[-2px] left-[calc(50%-100px)] z-[1] h-[192px] w-[204px] overflow-visible"
			data-factory-hard-hat=""
			fill="none"
			focusable="false"
			preserveAspectRatio="none"
			viewBox="0 0 205 193"
		>
			<defs>
				<clipPath id={clipId}>
					<path d={DOME} />
				</clipPath>
			</defs>
			{/* Each part paints an opaque underlay first, so the antenna loop,
			    the head's top band and the dome's base line under the brim
			    don't show through the translucent amber. */}
			<g className={HAT_STROKE} strokeLinejoin="round" strokeWidth={1.25}>
				<path className="fill-background" d={DOME} stroke="none" />
				<path className={HAT_FILL} d={DOME} data-hat-part="dome" />
				<path clipPath={`url(#${clipId})`} d={RIDGE} data-hat-part="ridge" />
				<path className="fill-background" d={BRIM} stroke="none" />
				<path className={HAT_FILL} d={BRIM} data-hat-part="brim" />
			</g>
		</svg>
	);
}
