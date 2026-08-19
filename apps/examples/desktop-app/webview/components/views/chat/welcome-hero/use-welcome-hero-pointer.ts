import { type RefObject, useEffect } from "react";
import { WELCOME_HERO_CONFIG } from "./hero-config";

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

interface WelcomeHeroPointerState {
	eyeX: number;
	eyeY: number;
	gridX: string;
	gridY: string;
}

function getWelcomeHeroPointerState(
	element: HTMLDivElement,
	clientX: number,
	clientY: number,
): WelcomeHeroPointerState | null {
	const bounds = element.getBoundingClientRect();
	if (bounds.width <= 0 || bounds.height <= 0) return null;

	const { frame, grid, eyes } = WELCOME_HERO_CONFIG;
	const pointerX = clientX - bounds.left;
	const pointerY = clientY - bounds.top;
	const gridX = clamp(pointerX, 0, bounds.width);
	const gridY = clamp(pointerY, 0, frame.height);
	const deltaX = pointerX - bounds.width / 2;
	const deltaY = pointerY - frame.height / 2;
	const distance = Math.hypot(deltaX, deltaY);
	const eyeStrength =
		Math.min(distance / eyes.falloffDistance, 1) * eyes.travel;
	const eyeX = distance === 0 ? 0 : (deltaX / distance) * eyeStrength;
	const eyeY = distance === 0 ? 0 : (deltaY / distance) * eyeStrength;

	return {
		eyeX,
		eyeY,
		gridX: `${((gridX / bounds.width) * 100).toFixed(2)}%`,
		gridY: `${(gridY + (grid.height - frame.height) / 2).toFixed(2)}px`,
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
): void {
	useEffect(() => {
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

			const { smoothing } = WELCOME_HERO_CONFIG.eyes;
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
	}, [heroRef]);
}
