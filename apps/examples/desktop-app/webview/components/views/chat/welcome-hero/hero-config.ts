/**
 * Values the pointer calculation needs when layout bounds are unavailable.
 *
 * Visual geometry belongs to welcome-hero.module.css. These two fallback sizes
 * mirror its default layout because jsdom and older webviews may not expose the
 * rendered grid bounds used by the normal pointer path.
 */
export const WELCOME_HERO_POINTER_CONFIG = {
	defaultFrameHeight: 220,
	defaultGridHeight: 520,
	eyes: {
		travel: 6, // Maximum distance the eyes move toward the pointer.
		falloffDistance: 200, // Pointer distance needed to reach maximum travel.
		smoothing: 0.22, // Fraction of the remaining distance moved per frame.
	},
} as const;
