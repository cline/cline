"use client";

import {
	AppWindow,
	Camera,
	Check,
	ChevronLeft,
	ChevronRight,
	Command,
	Keyboard,
	type LucideIcon,
	Maximize2,
	MonitorCheck,
	Mouse,
	MousePointerClick,
	Pause,
	Play,
	Scaling,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
	WorkVerification,
	WorkVerificationScreenshot,
} from "@/lib/chat-schema";
import { cn } from "@/lib/utils";

const ACTION_ICONS: Record<
	NonNullable<WorkVerificationScreenshot["action"]>,
	LucideIcon
> = {
	launch: AppWindow,
	screenshot: Camera,
	click: MousePointerClick,
	type: Keyboard,
	scroll: Mouse,
	key: Command,
	resize: Scaling,
};

const DEFAULT_INTERVAL_MS = 4000;

function formatDuration(durationMs: number): string {
	const seconds = Math.round(durationMs / 1000);
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function OutcomeDot({
	outcome,
	className,
}: {
	outcome: WorkVerificationScreenshot["outcome"];
	className?: string;
}) {
	if (!outcome || outcome === "info") return null;
	return (
		<span
			className={cn(
				"inline-flex size-3.5 items-center justify-center rounded-full text-white",
				outcome === "pass" ? "bg-emerald-500" : "bg-red-500",
				className,
			)}
		>
			{outcome === "pass" ? (
				<Check className="size-2.5" strokeWidth={3} />
			) : (
				<X className="size-2.5" strokeWidth={3} />
			)}
		</span>
	);
}

/**
 * Slideshow of the screenshots an agent captured while verifying its own work
 * in a sandbox. Autoplays with a per-frame progress segment, pauses while
 * hovered or after the user navigates manually, and expands to a lightbox.
 */
export function WorkVerificationCarousel({
	verification,
	autoPlay = true,
	intervalMs = DEFAULT_INTERVAL_MS,
	className,
}: {
	verification: WorkVerification;
	autoPlay?: boolean;
	intervalMs?: number;
	className?: string;
}) {
	const { screenshots } = verification;
	const count = screenshots.length;
	const [activeIndex, setActiveIndex] = useState(0);
	const [playing, setPlaying] = useState(autoPlay && count > 1);
	const [hovering, setHovering] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const fillRef = useRef<HTMLSpanElement>(null);
	const animationRef = useRef<Animation | null>(null);

	const safeIndex = Math.min(activeIndex, count - 1);
	const active = screenshots[safeIndex];
	const paused = !playing || hovering || expanded;
	const pausedRef = useRef(paused);
	pausedRef.current = paused;

	const goTo = useCallback(
		(index: number, { manual = true } = {}) => {
			setActiveIndex(((index % count) + count) % count);
			if (manual) setPlaying(false);
		},
		[count],
	);

	// One Web Animation per frame drives the progress segment and, on finish,
	// advances the slideshow; pausing the animation pauses the timer with it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: safeIndex restarts the animation for each new frame
	useEffect(() => {
		const fill = fillRef.current;
		if (!playing || !fill || typeof fill.animate !== "function") return;
		const animation = fill.animate(
			[{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
			{ duration: intervalMs, easing: "linear", fill: "forwards" },
		);
		animation.onfinish = () => setActiveIndex((index) => (index + 1) % count);
		if (pausedRef.current) animation.pause();
		animationRef.current = animation;
		return () => {
			animation.cancel();
			animationRef.current = null;
		};
	}, [playing, safeIndex, intervalMs, count]);

	useEffect(() => {
		const animation = animationRef.current;
		if (!animation) return;
		if (paused) animation.pause();
		else animation.play();
	}, [paused]);

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === "ArrowRight") {
			event.preventDefault();
			goTo(safeIndex + 1);
		} else if (event.key === "ArrowLeft") {
			event.preventDefault();
			goTo(safeIndex - 1);
		} else if (event.key === " ") {
			event.preventDefault();
			setPlaying((value) => !value);
		}
	};

	if (!active) return null;

	const failures = screenshots.filter((shot) => shot.outcome === "fail");
	const ActionIcon = active.action ? ACTION_ICONS[active.action] : Camera;
	const subtitle = [
		verification.target,
		`${count} screenshot${count === 1 ? "" : "s"}`,
		verification.durationMs !== undefined
			? formatDuration(verification.durationMs)
			: null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<section
			aria-label="Verification screenshots"
			className={cn(
				"flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm",
				className,
			)}
			data-testid="work-verification"
		>
			<header className="flex items-start justify-between gap-3 px-3.5 pt-3 pb-2.5">
				<div className="flex min-w-0 items-start gap-2.5">
					<span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
						<MonitorCheck className="size-4" />
					</span>
					<div className="min-w-0">
						<p className="truncate text-sm font-medium leading-5">
							{verification.summary}
						</p>
						<p className="truncate text-xs text-muted-foreground">{subtitle}</p>
					</div>
				</div>
				<span
					className={cn(
						"inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
						failures.length === 0
							? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
							: "bg-red-500/15 text-red-700 dark:text-red-300",
					)}
				>
					{failures.length === 0 ? (
						<>
							<Check className="size-3" strokeWidth={3} />
							All checks passed
						</>
					) : (
						<>
							<X className="size-3" strokeWidth={3} />
							{failures.length} check{failures.length === 1 ? "" : "s"} failed
						</>
					)}
				</span>
			</header>

			{/* biome-ignore lint/a11y/noStaticElementInteractions: hover only pauses autoplay; keyboard handling lives on the focusable stage below. */}
			<div
				className="group relative aspect-[16/10] w-full overflow-hidden bg-black"
				onMouseEnter={() => setHovering(true)}
				onMouseLeave={() => setHovering(false)}
			>
				{/* biome-ignore lint/performance/noImgElement: sandbox artifacts have no static dimensions for Next's optimizer. */}
				<img
					alt=""
					aria-hidden
					className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-2xl"
					src={active.src}
				/>
				<button
					aria-label={`Expand screenshot ${safeIndex + 1}: ${active.title}`}
					className="absolute inset-0 flex cursor-zoom-in items-center justify-center p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
					onClick={() => setExpanded(true)}
					onKeyDown={handleKeyDown}
					type="button"
				>
					{/* biome-ignore lint/performance/noImgElement: see above. */}
					<img
						alt={active.title}
						className="max-h-full max-w-full rounded-md object-contain shadow-2xl ring-1 ring-white/10"
						key={active.id}
						src={active.src}
					/>
				</button>

				<div
					aria-hidden
					className="pointer-events-none absolute inset-x-0 top-0 flex gap-1 px-2.5 pt-2.5"
				>
					{screenshots.map((shot, index) => (
						<span
							className="h-0.75 flex-1 overflow-hidden rounded-full bg-white/30"
							key={shot.id}
						>
							<span
								className={cn(
									"block h-full origin-left rounded-full bg-white",
									index < safeIndex && "scale-x-100",
									index > safeIndex && "scale-x-0",
									index === safeIndex && !playing && "scale-x-100",
									index === safeIndex && playing && "scale-x-0",
								)}
								ref={index === safeIndex ? fillRef : undefined}
							/>
						</span>
					))}
				</div>

				{count > 1 ? (
					<>
						<button
							aria-label="Previous screenshot"
							className="absolute left-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100"
							onClick={() => goTo(safeIndex - 1)}
							type="button"
						>
							<ChevronLeft className="size-4" />
						</button>
						<button
							aria-label="Next screenshot"
							className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100"
							onClick={() => goTo(safeIndex + 1)}
							type="button"
						>
							<ChevronRight className="size-4" />
						</button>
					</>
				) : null}

				<div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3.5 pt-10 pb-3 text-white">
					<div className="min-w-0">
						<div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/70">
							<span className="inline-flex items-center gap-1 rounded bg-white/15 px-1.5 py-0.5 normal-case tracking-normal">
								<ActionIcon className="size-3" />
								{active.action ?? "screenshot"}
							</span>
							<span>
								{safeIndex + 1} / {count}
							</span>
							<OutcomeDot outcome={active.outcome} />
						</div>
						<p className="truncate text-sm font-medium">{active.title}</p>
						{active.note ? (
							<p className="line-clamp-2 text-xs text-white/75">
								{active.note}
							</p>
						) : null}
					</div>
					<div className="pointer-events-auto flex shrink-0 items-center gap-1">
						{count > 1 ? (
							<button
								aria-label={playing ? "Pause slideshow" : "Play slideshow"}
								className="flex size-7 items-center justify-center rounded-full bg-white/15 backdrop-blur transition-colors hover:bg-white/30"
								onClick={() => setPlaying((value) => !value)}
								type="button"
							>
								{playing ? (
									<Pause className="size-3.5" fill="currentColor" />
								) : (
									<Play className="size-3.5" fill="currentColor" />
								)}
							</button>
						) : null}
						<button
							aria-label="Expand screenshot"
							className="flex size-7 items-center justify-center rounded-full bg-white/15 backdrop-blur transition-colors hover:bg-white/30"
							onClick={() => setExpanded(true)}
							type="button"
						>
							<Maximize2 className="size-3.5" />
						</button>
					</div>
				</div>
			</div>

			{count > 1 ? (
				<div className="flex gap-1.5 overflow-x-auto px-2.5 py-2">
					{screenshots.map((shot, index) => (
						<button
							aria-current={index === safeIndex}
							aria-label={`Show screenshot ${index + 1}: ${shot.title}`}
							className={cn(
								"relative h-11 shrink-0 overflow-hidden rounded-md bg-muted ring-2 ring-offset-1 ring-offset-card transition-opacity",
								index === safeIndex
									? "ring-primary"
									: "opacity-55 ring-transparent hover:opacity-100",
							)}
							key={shot.id}
							onClick={() => goTo(index)}
							style={{ aspectRatio: "16 / 10" }}
							type="button"
						>
							{/* biome-ignore lint/performance/noImgElement: see above. */}
							<img
								alt=""
								className="size-full object-cover object-top"
								src={shot.src}
							/>
							<OutcomeDot
								className="absolute right-0.5 bottom-0.5 size-3 ring-1 ring-black/40"
								outcome={shot.outcome}
							/>
						</button>
					))}
				</div>
			) : null}

			{expanded
				? createPortal(
						<WorkVerificationLightbox
							index={safeIndex}
							onClose={() => setExpanded(false)}
							onNavigate={(index) => goTo(index)}
							screenshots={screenshots}
						/>,
						document.body,
					)
				: null}
		</section>
	);
}

function WorkVerificationLightbox({
	screenshots,
	index,
	onNavigate,
	onClose,
}: {
	screenshots: WorkVerificationScreenshot[];
	index: number;
	onNavigate: (index: number) => void;
	onClose: () => void;
}) {
	const shot = screenshots[index];
	const count = screenshots.length;

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
			else if (event.key === "ArrowRight") onNavigate(index + 1);
			else if (event.key === "ArrowLeft") onNavigate(index - 1);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [index, onClose, onNavigate]);

	if (!shot) return null;

	return (
		<div
			aria-label={`Screenshot ${index + 1} of ${count}`}
			aria-modal="true"
			className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4 text-white backdrop-blur-sm"
			role="dialog"
		>
			<button
				aria-label="Close screenshot viewer"
				className="absolute inset-0 cursor-zoom-out"
				onClick={onClose}
				type="button"
			/>
			<div className="pointer-events-none relative z-10 flex min-h-0 flex-1 items-center justify-center">
				{/* biome-ignore lint/performance/noImgElement: see above. */}
				<img
					alt={shot.title}
					className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
					src={shot.src}
				/>
			</div>
			<div className="pointer-events-none relative z-10 mx-auto mt-3 flex w-full max-w-3xl items-center justify-between gap-4">
				<div className="min-w-0">
					<p className="truncate text-sm font-medium">
						<span className="mr-2 text-white/50">
							{index + 1} / {count}
						</span>
						{shot.title}
					</p>
					{shot.note ? (
						<p className="truncate text-xs text-white/70">{shot.note}</p>
					) : null}
				</div>
				<div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
					<button
						aria-label="Previous screenshot"
						className="flex size-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/25"
						onClick={() => onNavigate(index - 1)}
						type="button"
					>
						<ChevronLeft className="size-4" />
					</button>
					<button
						aria-label="Next screenshot"
						className="flex size-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/25"
						onClick={() => onNavigate(index + 1)}
						type="button"
					>
						<ChevronRight className="size-4" />
					</button>
					<button
						aria-label="Close"
						className="ml-1 flex size-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/25"
						onClick={onClose}
						type="button"
					>
						<X className="size-4" />
					</button>
				</div>
			</div>
		</div>
	);
}
