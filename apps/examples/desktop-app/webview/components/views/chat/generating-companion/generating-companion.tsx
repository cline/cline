"use client";

import { Pause, Play } from "lucide-react";
import {
	type MouseEvent,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COMPANION_DANCES, danceKeyframes } from "./dances";

type GeneratingCompanionProps = {
	active: boolean;
	className?: string;
	draftRef?: RefObject<HTMLTextAreaElement | null>;
	paused?: boolean;
	onPausedChange?: (paused: boolean) => void;
};

function useReducedMotion() {
	// Start still on the server and during hydration; motion starts only after
	// the local preference is known, avoiding a flash of unwanted animation.
	const [reducedMotion, setReducedMotion] = useState(true);
	useEffect(() => {
		if (typeof window.matchMedia !== "function") {
			setReducedMotion(false);
			return;
		}
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReducedMotion(query.matches);
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	return reducedMotion;
}

/** Activity presentation only: the owner decides whether Cline is working. */
export function GeneratingCompanion({
	active,
	className,
	draftRef,
	paused,
	onPausedChange,
}: GeneratingCompanionProps) {
	const [danceIndex, setDanceIndex] = useState(0);
	const [localPaused, setLocalPaused] = useState(false);
	const motionPaused = paused ?? localPaused;
	const reducedMotion = useReducedMotion();
	const dance = COMPANION_DANCES[danceIndex] ?? COMPANION_DANCES[0];
	const controlsRef = useRef<HTMLSpanElement>(null);
	const spriteRef = useRef<HTMLSpanElement>(null);
	const animationRef = useRef<Animation | null>(null);
	const controlsHadFocusRef = useRef(false);
	const activeRef = useRef(active);
	activeRef.current = active;
	const playbackRef = useRef({ motionPaused, reducedMotion, active });
	playbackRef.current = { motionPaused, reducedMotion, active };

	useLayoutEffect(() => {
		const sprite = spriteRef.current;
		if (
			!active ||
			reducedMotion ||
			!sprite ||
			typeof sprite.animate !== "function"
		) {
			return;
		}
		const animation = sprite.animate(danceKeyframes(dance.durations), {
			duration: dance.durations.reduce((sum, duration) => sum + duration, 0),
			iterations: Number.POSITIVE_INFINITY,
			easing: "linear",
		});
		animationRef.current = animation;
		if (playbackRef.current.motionPaused || sprite.ownerDocument.hidden) {
			animation.pause();
		}
		return () => {
			animation.cancel();
			animationRef.current = null;
		};
	}, [active, dance, reducedMotion]);

	useLayoutEffect(() => {
		if (motionPaused || reducedMotion || document.hidden) {
			animationRef.current?.pause();
		} else if (active) {
			animationRef.current?.play();
		}
	}, [active, motionPaused, reducedMotion]);

	useEffect(() => {
		const update = () => {
			const state = playbackRef.current;
			if (document.hidden || state.motionPaused || state.reducedMotion) {
				animationRef.current?.pause();
			} else if (state.active) {
				animationRef.current?.play();
			}
		};
		document.addEventListener("visibilitychange", update);
		return () => document.removeEventListener("visibilitychange", update);
	}, []);

	useLayoutEffect(() => {
		if (active) return;
		const controls = controlsRef.current;
		const document = controls?.ownerDocument;
		// Hiding the focused button may already have sent native focus to body.
		// Preserve that intent without taking focus from another deliberate target.
		if (
			controlsHadFocusRef.current &&
			document &&
			(document.activeElement === document.body ||
				controls?.contains(document.activeElement))
		) {
			draftRef?.current?.focus({ preventScroll: true });
		}
		controlsHadFocusRef.current = false;
	}, [active, draftRef]);

	function preserveDraftFocus(event: MouseEvent<HTMLButtonElement>) {
		if (
			event.button === 0 &&
			draftRef?.current &&
			event.currentTarget.ownerDocument.activeElement === draftRef.current
		) {
			event.preventDefault();
		}
	}

	function togglePaused(event: MouseEvent<HTMLButtonElement>) {
		event.stopPropagation();
		const next = !motionPaused;
		if (paused === undefined) setLocalPaused(next);
		onPausedChange?.(next);
	}

	return (
		<span
			ref={controlsRef}
			className={cn(
				"inline-flex shrink-0 flex-col items-center",
				className,
				!active && "hidden",
			)}
			hidden={!active}
			onFocusCapture={() => {
				controlsHadFocusRef.current = true;
			}}
			onBlurCapture={(event) => {
				if (
					activeRef.current &&
					!event.currentTarget.contains(event.relatedTarget)
				) {
					controlsHadFocusRef.current = false;
				}
			}}
		>
			<Button
				type="button"
				variant="ghost"
				size="icon-lg"
				className="size-[44px] p-0 text-muted-foreground"
				aria-label={`Change Cline dance. Current dance: ${dance.name}`}
				title={`${dance.name} · Click to change dance`}
				onMouseDown={preserveDraftFocus}
				onClick={(event) => {
					event.stopPropagation();
					setDanceIndex((index) => (index + 1) % COMPANION_DANCES.length);
				}}
			>
				<span
					ref={spriteRef}
					aria-hidden="true"
					className="pointer-events-none block size-[28px] shrink-0 bg-no-repeat opacity-70 grayscale dark:invert"
					style={{
						backgroundImage: `url("${dance.src}")`,
						backgroundSize: `${dance.durations.length * 100}% 100%`,
						backgroundPosition: "0% 0%",
					}}
				/>
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				className="size-[28px] p-0 text-muted-foreground pointer-coarse:size-[44px]"
				disabled={reducedMotion}
				aria-label={
					reducedMotion
						? "Companion motion follows your reduced-motion preference"
						: motionPaused
							? "Resume companion animation"
							: "Pause companion animation"
				}
				aria-pressed={motionPaused || reducedMotion}
				title={
					reducedMotion
						? "Reduced motion is enabled"
						: motionPaused
							? "Resume animation"
							: "Pause animation"
				}
				onMouseDown={preserveDraftFocus}
				onClick={togglePaused}
			>
				{motionPaused || reducedMotion ? (
					<Play className="size-3.5" aria-hidden="true" />
				) : (
					<Pause className="size-3.5" aria-hidden="true" />
				)}
			</Button>
		</span>
	);
}
