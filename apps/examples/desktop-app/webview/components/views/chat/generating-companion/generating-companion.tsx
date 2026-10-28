"use client";

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
}: GeneratingCompanionProps) {
	const [danceIndex, setDanceIndex] = useState(0);
	const reducedMotion = useReducedMotion();
	const dance = COMPANION_DANCES[danceIndex] ?? COMPANION_DANCES[0];
	const controlsRef = useRef<HTMLSpanElement>(null);
	const spriteRef = useRef<HTMLSpanElement>(null);
	const animationRef = useRef<Animation | null>(null);
	const controlsHadFocusRef = useRef(false);
	const activeRef = useRef(active);
	activeRef.current = active;

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
		if (sprite.ownerDocument.hidden) {
			animation.pause();
		}
		return () => {
			animation.cancel();
			animationRef.current = null;
		};
	}, [active, dance, reducedMotion]);

	useEffect(() => {
		const update = () => {
			if (document.hidden) {
				animationRef.current?.pause();
			} else {
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

	return (
		<span
			ref={controlsRef}
			className={cn(
				"inline-flex shrink-0 items-center",
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
					className="pointer-events-none block size-[28px] shrink-0 bg-no-repeat opacity-70 grayscale"
					style={{
						backgroundImage: `url("${dance.src}")`,
						backgroundSize: `${dance.durations.length * 100}% 100%`,
						backgroundPosition: "0% 0%",
					}}
				/>
			</Button>
		</span>
	);
}
