import { type RefObject, useEffect } from "react";
import { WELCOME_HERO_POINTER_CONFIG } from "./hero-config";

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

interface WelcomeHeroPointerState {
	eyeX: number;
	eyeY: number;
	gridX: string;
	gridY: string;
}

const WELCOME_HERO_POINTER_PROPERTIES = [
	"--welcome-grid-x",
	"--welcome-grid-y",
	"--welcome-eye-x",
	"--welcome-eye-y",
] as const;

function resetWelcomeHeroPointerStyles(element: HTMLDivElement | null): void {
	if (!element) return;
	for (const property of WELCOME_HERO_POINTER_PROPERTIES) {
		element.style.removeProperty(property);
	}
}

function getWelcomeHeroPointerState(
	element: HTMLDivElement,
	clientX: number,
	clientY: number,
): WelcomeHeroPointerState | null {
	const bounds = element.getBoundingClientRect();
	if (bounds.width <= 0 || bounds.height <= 0) return null;

	const { defaultFrameHeight, defaultGridHeight, eyes } =
		WELCOME_HERO_POINTER_CONFIG;
	const pointerX = clientX - bounds.left;
	const pointerY = clientY - bounds.top;
	const gridElement = element.querySelector<HTMLElement>(
		'[data-welcome-hero-layer="grid"]',
	);
	const gridBounds = gridElement?.getBoundingClientRect();
	const hasRenderedGridBounds =
		gridBounds !== undefined && gridBounds.width > 0 && gridBounds.height > 0;
	const gridX = hasRenderedGridBounds
		? `${(
				(clamp(clientX - gridBounds.left, 0, gridBounds.width) /
					gridBounds.width) *
					100
			).toFixed(2)}%`
		: `${((clamp(pointerX, 0, bounds.width) / bounds.width) * 100).toFixed(2)}%`;
	const gridY = hasRenderedGridBounds
		? `${(
				(clamp(clientY - gridBounds.top, 0, gridBounds.height) /
					gridBounds.height) *
					100
			).toFixed(2)}%`
		: `${(
				clamp(pointerY, 0, defaultFrameHeight) +
					(defaultGridHeight - defaultFrameHeight) / 2
			).toFixed(2)}px`;
	const deltaX = pointerX - bounds.width / 2;
	const deltaY = pointerY - defaultFrameHeight / 2;
	const distance = Math.hypot(deltaX, deltaY);
	const eyeStrength =
		Math.min(distance / eyes.falloffDistance, 1) * eyes.travel;
	const eyeX = distance === 0 ? 0 : (deltaX / distance) * eyeStrength;
	const eyeY = distance === 0 ? 0 : (deltaY / distance) * eyeStrength;

	return {
		eyeX,
		eyeY,
		gridX,
		gridY,
	};
}

function applyWelcomeHeroEyeState(
	element: HTMLDivElement,
	eyeX: number,
	eyeY: number,
): void {
	element.style.setProperty("--welcome-eye-x", `${eyeX.toFixed(2)}px`);
	element.style.setProperty("--welcome-eye-y", `${eyeY.toFixed(2)}px`);
}

/** Tracks the full page while keeping the visual response clamped to the hero. */
export function useWelcomeHeroPointer(
	heroRef: RefObject<HTMLDivElement | null>,
	enabled = true,
): void {
	useEffect(() => {
		if (!enabled) return;

		let animationFrame: number | null = null;
		let currentEyeX = 0;
		let currentEyeY = 0;
		let targetEyeX = 0;
		let targetEyeY = 0;
		let latestClientX = 0;
		let latestClientY = 0;
		let pointerDirty = false;
		let trackingPointer = false;

		const updatePointerTarget = (hero: HTMLDivElement): boolean => {
			if (!pointerDirty) return false;
			const target = getWelcomeHeroPointerState(
				hero,
				latestClientX,
				latestClientY,
			);
			pointerDirty = false;
			if (!target) return false;

			hero.style.setProperty("--welcome-grid-x", target.gridX);
			hero.style.setProperty("--welcome-grid-y", target.gridY);
			targetEyeX = target.eyeX;
			targetEyeY = target.eyeY;
			return true;
		};

		const drawFrame = () => {
			animationFrame = null;
			const hero = heroRef.current;
			if (!hero) return;

			updatePointerTarget(hero);

			const { smoothing } = WELCOME_HERO_POINTER_CONFIG.eyes;
			currentEyeX += (targetEyeX - currentEyeX) * smoothing;
			currentEyeY += (targetEyeY - currentEyeY) * smoothing;

			const settledX = Math.abs(targetEyeX - currentEyeX) < 0.01;
			const settledY = Math.abs(targetEyeY - currentEyeY) < 0.01;
			if (settledX) currentEyeX = targetEyeX;
			if (settledY) currentEyeY = targetEyeY;

			applyWelcomeHeroEyeState(hero, currentEyeX, currentEyeY);

			if (!settledX || !settledY) {
				animationFrame = window.requestAnimationFrame(drawFrame);
			}
		};

		const handlePointerMove = (event: PointerEvent) => {
			const hero = heroRef.current;
			if (!hero) return;

			latestClientX = event.clientX;
			latestClientY = event.clientY;
			pointerDirty = true;

			// jsdom and older webviews may not expose requestAnimationFrame.
			if (typeof window.requestAnimationFrame !== "function") {
				if (updatePointerTarget(hero)) {
					currentEyeX = targetEyeX;
					currentEyeY = targetEyeY;
					applyWelcomeHeroEyeState(hero, currentEyeX, currentEyeY);
				}
				return;
			}

			if (animationFrame === null) {
				animationFrame = window.requestAnimationFrame(drawFrame);
			}
		};

		const startPointerTracking = () => {
			if (trackingPointer) return;
			window.addEventListener("pointermove", handlePointerMove, {
				passive: true,
			});
			trackingPointer = true;
		};

		const stopPointerTracking = () => {
			if (trackingPointer) {
				window.removeEventListener("pointermove", handlePointerMove);
				trackingPointer = false;
			}
			if (animationFrame !== null) {
				window.cancelAnimationFrame(animationFrame);
				animationFrame = null;
			}
			pointerDirty = false;
			currentEyeX = 0;
			currentEyeY = 0;
			targetEyeX = 0;
			targetEyeY = 0;
			resetWelcomeHeroPointerStyles(heroRef.current);
		};

		const motionPreference = window.matchMedia?.(
			"(prefers-reduced-motion: reduce)",
		);
		const syncMotionPreference = () => {
			if (motionPreference?.matches) stopPointerTracking();
			else startPointerTracking();
		};

		syncMotionPreference();
		motionPreference?.addEventListener("change", syncMotionPreference);
		return () => {
			motionPreference?.removeEventListener("change", syncMotionPreference);
			stopPointerTracking();
		};
	}, [enabled, heroRef]);
}
