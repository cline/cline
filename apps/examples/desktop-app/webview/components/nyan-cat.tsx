"use client";

import { AppWindow, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	DEFAULT_NYAN_PET_SRC,
	getNyanPetSrc,
	subscribeNyanPet,
} from "@/lib/nyan-pet";
import { hidePet, showMainWindow, startPetDrag } from "@/lib/pet-window";

const NYAN_WIDTH = 160;
const NYAN_HEIGHT = 96;
const MARGIN = 32;

/**
 * Shared pet media: the current gif source (kept in sync with Settings) plus an
 * audio element that plays only while the pet is hovered or being dragged.
 */
function useNyanPetMedia() {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [petSrc, setPetSrc] = useState(DEFAULT_NYAN_PET_SRC);
	const [hovering, setHovering] = useState(false);
	const [dragging, setDragging] = useState(false);

	useEffect(() => {
		setPetSrc(getNyanPetSrc());
		return subscribeNyanPet(() => setPetSrc(getNyanPetSrc()));
	}, []);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) {
			return;
		}
		if (hovering || dragging) {
			void audio.play().catch(() => {});
		} else {
			audio.pause();
			audio.currentTime = 0;
		}
	}, [hovering, dragging]);

	return { audioRef, petSrc, hovering, setHovering, dragging, setDragging };
}

/**
 * In-page pet used in plain web/dev mode (no Tauri). Free-floating and draggable
 * within the window; its theme song plays while hovered or dragged. In the
 * desktop app the pet lives in its own always-on-top window (see PetWindowView).
 */
export function NyanCat() {
	const [visible, setVisible] = useState(true);
	const [position, setPosition] = useState({ x: MARGIN, y: MARGIN });
	const { audioRef, petSrc, dragging, setDragging, setHovering } =
		useNyanPetMedia();
	const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

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
	}, [dragging, clamp, setDragging]);

	useEffect(() => {
		const handleResize = () =>
			setPosition((current) => clamp(current.x, current.y));
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [clamp]);

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

/**
 * The pet as rendered inside its own transparent, always-on-top Tauri window.
 * Dragging moves the OS window (so it can go anywhere on screen, even when the
 * main window is minimized), and the dismiss button hides the window.
 */
export function PetWindowView() {
	const { audioRef, petSrc, dragging, setDragging, setHovering } =
		useNyanPetMedia();

	// Make the window chrome see-through so only the pet shows.
	useEffect(() => {
		const root = document.documentElement;
		const body = document.body;
		const prevRoot = root.style.background;
		const prevBody = body.style.background;
		root.style.background = "transparent";
		body.style.background = "transparent";
		return () => {
			root.style.background = prevRoot;
			body.style.background = prevBody;
		};
	}, []);

	// The OS drag can swallow the pointerup; reset on any pointer release.
	useEffect(() => {
		if (!dragging) {
			return;
		}
		const stop = () => setDragging(false);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
		return () => {
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
		};
	}, [dragging, setDragging]);

	return (
		<div className="group fixed inset-0 flex select-none items-center justify-center">
			<div
				className="relative cursor-grab active:cursor-grabbing"
				onPointerDown={(event) => {
					if ((event.target as HTMLElement).closest("[data-nyan-control]")) {
						return;
					}
					setDragging(true);
					void startPetDrag();
				}}
				onPointerEnter={() => setHovering(true)}
				onPointerLeave={() => setHovering(false)}
			>
				<button
					aria-label="Open Cline window"
					className="absolute -left-1 -top-1 hidden size-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow ring-1 ring-border group-hover:flex"
					data-nyan-control=""
					onClick={() => void showMainWindow()}
					title="Open Cline"
					type="button"
				>
					<AppWindow className="size-3" />
				</button>
				<button
					aria-label="Hide desktop pet"
					className="absolute -right-1 -top-1 hidden size-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow ring-1 ring-border group-hover:flex"
					data-nyan-control=""
					onClick={() => void hidePet()}
					title="Hide pet"
					type="button"
				>
					<X className="size-3" />
				</button>
				{/* biome-ignore lint/performance/noImgElement: static public asset, not statically optimizable */}
				<img
					alt="Desktop pet"
					className="pointer-events-none drop-shadow-lg"
					draggable={false}
					height={NYAN_HEIGHT}
					src={petSrc}
					width={NYAN_WIDTH}
				/>
			</div>
			{/* biome-ignore lint/a11y/useMediaCaption: decorative background music */}
			<audio loop preload="auto" ref={audioRef} src="/nyantune.mp3" />
		</div>
	);
}
