"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	DEFAULT_NYAN_PET_SRC,
	getNyanPetSrc,
	subscribeNyanPet,
} from "@/lib/nyan-pet";

const NYAN_WIDTH = 160;
const NYAN_HEIGHT = 96;
const MARGIN = 32;

/**
 * A free-floating Nyan Cat that the user can drag anywhere on screen. Its theme
 * song plays only while the pointer is hovering over it or dragging it, and
 * stops as soon as the pointer leaves.
 */
export function NyanCat() {
	const [visible, setVisible] = useState(true);
	const [position, setPosition] = useState({ x: MARGIN, y: MARGIN });
	const [dragging, setDragging] = useState(false);
	const [hovering, setHovering] = useState(false);
	// Start from the bundled default so server and first client render match,
	// then adopt any custom upload once localStorage is available.
	const [petSrc, setPetSrc] = useState(DEFAULT_NYAN_PET_SRC);
	const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);

	useEffect(() => {
		setPetSrc(getNyanPetSrc());
		return subscribeNyanPet(() => setPetSrc(getNyanPetSrc()));
	}, []);

	// Park it in the bottom-right once we know the viewport size.
	useEffect(() => {
		setPosition({
			x: Math.max(MARGIN, window.innerWidth - NYAN_WIDTH - MARGIN),
			y: Math.max(MARGIN, window.innerHeight - NYAN_HEIGHT - MARGIN),
		});
	}, []);

	const clamp = useCallback((x: number, y: number) => {
		const maxX = Math.max(0, window.innerWidth - NYAN_WIDTH);
		const maxY = Math.max(0, window.innerHeight - NYAN_HEIGHT);
		return {
			x: Math.min(Math.max(0, x), maxX),
			y: Math.min(Math.max(0, y), maxY),
		};
	}, []);

	useEffect(() => {
		if (!dragging) {
			return;
		}
		const handleMove = (event: PointerEvent) => {
			const offset = dragOffsetRef.current;
			if (!offset) {
				return;
			}
			setPosition(clamp(event.clientX - offset.x, event.clientY - offset.y));
		};
		const stop = () => {
			dragOffsetRef.current = null;
			setDragging(false);
		};
		window.addEventListener("pointermove", handleMove);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
		return () => {
			window.removeEventListener("pointermove", handleMove);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
		};
	}, [dragging, clamp]);

	// Keep it on screen if the window is resized.
	useEffect(() => {
		const handleResize = () =>
			setPosition((current) => clamp(current.x, current.y));
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [clamp]);

	// Play the theme song only while the pet is hovered or being dragged.
	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) {
			return;
		}
		if (hovering || dragging) {
			// Autoplay may be blocked until the first real gesture; dragging starts
			// with a pointerdown, which unlocks playback for subsequent hovers.
			void audio.play().catch(() => {});
		} else {
			audio.pause();
			audio.currentTime = 0;
		}
	}, [hovering, dragging]);

	if (!visible) {
		return null;
	}

	return (
		<div
			className="group fixed z-50 cursor-grab select-none active:cursor-grabbing"
			onPointerDown={(event) => {
				if ((event.target as HTMLElement).closest("[data-nyan-control]")) {
					return;
				}
				event.preventDefault();
				dragOffsetRef.current = {
					x: event.clientX - position.x,
					y: event.clientY - position.y,
				};
				setDragging(true);
			}}
			onPointerEnter={() => setHovering(true)}
			onPointerLeave={() => setHovering(false)}
			style={{ left: position.x, top: position.y, width: NYAN_WIDTH }}
		>
			<button
				aria-label="Hide Nyan Cat"
				className="absolute -right-2 -top-2 hidden size-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow ring-1 ring-border group-hover:flex"
				data-nyan-control=""
				onClick={() => setVisible(false)}
				type="button"
			>
				<X className="size-3" />
			</button>
			{/* biome-ignore lint/performance/noImgElement: static public asset, not statically optimizable */}
			<img
				alt="Desktop pet"
				className="pointer-events-none w-full drop-shadow-lg"
				draggable={false}
				height={NYAN_HEIGHT}
				src={petSrc}
				width={NYAN_WIDTH}
			/>
			{/* biome-ignore lint/a11y/useMediaCaption: decorative background music */}
			<audio loop preload="auto" ref={audioRef} src="/nyantune.mp3" />
		</div>
	);
}
