import type { WorkVerification, WorkVerificationScreenshot } from "@shared/ExtensionMessage"
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
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

const ACTION_ICONS: Record<NonNullable<WorkVerificationScreenshot["action"]>, LucideIcon> = {
	launch: AppWindow,
	screenshot: Camera,
	click: MousePointerClick,
	type: Keyboard,
	scroll: Mouse,
	key: Command,
	resize: Scaling,
}

const DEFAULT_INTERVAL_MS = 4000

function formatDuration(durationMs: number): string {
	const seconds = Math.round(durationMs / 1000)
	if (seconds < 60) return `${seconds}s`
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function OutcomeDot({ outcome, className }: { outcome: WorkVerificationScreenshot["outcome"]; className?: string }) {
	if (!outcome || outcome === "info") return null
	return (
		<span
			className={cn(
				"inline-flex size-3.5 items-center justify-center rounded-full text-white",
				outcome === "pass" ? "bg-emerald-500" : "bg-red-500",
				className,
			)}>
			{outcome === "pass" ? <Check className="size-2.5" strokeWidth={3} /> : <X className="size-2.5" strokeWidth={3} />}
		</span>
	)
}

interface WorkVerificationCarouselProps {
	verification: WorkVerification
	autoPlay?: boolean
	intervalMs?: number
	className?: string
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
}: WorkVerificationCarouselProps) {
	const { screenshots } = verification
	const count = screenshots.length
	const [activeIndex, setActiveIndex] = useState(0)
	const [playing, setPlaying] = useState(autoPlay && count > 1)
	const [hovering, setHovering] = useState(false)
	const [expanded, setExpanded] = useState(false)
	const fillRef = useRef<HTMLSpanElement>(null)
	const animationRef = useRef<Animation | null>(null)

	const safeIndex = Math.min(activeIndex, count - 1)
	const active = screenshots[safeIndex]
	const paused = !playing || hovering || expanded
	const pausedRef = useRef(paused)
	pausedRef.current = paused

	const goTo = useCallback(
		(index: number, { manual = true } = {}) => {
			setActiveIndex(((index % count) + count) % count)
			if (manual) setPlaying(false)
		},
		[count],
	)

	// One Web Animation per frame drives the progress segment and, on finish,
	// advances the slideshow; pausing the animation pauses the timer with it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: safeIndex restarts the animation for each new frame
	useEffect(() => {
		const fill = fillRef.current
		if (!playing || !fill || typeof fill.animate !== "function") return
		const animation = fill.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
			duration: intervalMs,
			easing: "linear",
			fill: "forwards",
		})
		animation.onfinish = () => setActiveIndex((index) => (index + 1) % count)
		if (pausedRef.current) animation.pause()
		animationRef.current = animation
		return () => {
			animation.cancel()
			animationRef.current = null
		}
	}, [playing, safeIndex, intervalMs, count])

	useEffect(() => {
		const animation = animationRef.current
		if (!animation) return
		if (paused) animation.pause()
		else animation.play()
	}, [paused])

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === "ArrowRight") {
			event.preventDefault()
			goTo(safeIndex + 1)
		} else if (event.key === "ArrowLeft") {
			event.preventDefault()
			goTo(safeIndex - 1)
		} else if (event.key === " ") {
			event.preventDefault()
			setPlaying((value) => !value)
		}
	}

	if (!active) return null

	const failures = screenshots.filter((shot) => shot.outcome === "fail")
	const ActionIcon = active.action ? ACTION_ICONS[active.action] : Camera
	const subtitle = [
		verification.target,
		`${count} screenshot${count === 1 ? "" : "s"}`,
		verification.durationMs !== undefined ? formatDuration(verification.durationMs) : null,
	]
		.filter(Boolean)
		.join(" · ")

	return (
		<section
			aria-label="Verification screenshots"
			className={cn("flex w-full flex-col overflow-hidden rounded-sm border border-border-panel bg-code", className)}
			data-testid="work-verification">
			<header className="flex items-start justify-between gap-3 px-2.5 pt-2.5 pb-2">
				<div className="flex min-w-0 items-start gap-2">
					<span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded bg-success/15 text-success">
						<MonitorCheck className="size-3.5" />
					</span>
					<div className="min-w-0">
						<p className="m-0 truncate text-sm font-medium leading-5">{verification.summary}</p>
						<p className="m-0 truncate text-xs text-description">{subtitle}</p>
					</div>
				</div>
				<span
					className={cn(
						"inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
						failures.length === 0 ? "bg-success/15 text-success" : "bg-error/15 text-error",
					)}>
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
				onMouseLeave={() => setHovering(false)}>
				<img
					alt=""
					aria-hidden
					className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-2xl"
					src={active.src}
				/>
				<button
					aria-label={`Expand screenshot ${safeIndex + 1}: ${active.title}`}
					className="absolute inset-0 flex cursor-zoom-in items-center justify-center border-0 bg-transparent p-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border"
					onClick={() => setExpanded(true)}
					onKeyDown={handleKeyDown}
					type="button">
					<img
						alt={active.title}
						className="max-h-full max-w-full rounded object-contain shadow-2xl ring-1 ring-white/10"
						key={active.id}
						src={active.src}
					/>
				</button>

				<div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex gap-1 px-2 pt-2">
					{screenshots.map((shot, index) => (
						<span className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30" key={shot.id}>
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
							className="absolute left-1.5 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-black/50 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100"
							onClick={() => goTo(safeIndex - 1)}
							type="button">
							<ChevronLeft className="size-4" />
						</button>
						<button
							aria-label="Next screenshot"
							className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-black/50 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100"
							onClick={() => goTo(safeIndex + 1)}
							type="button">
							<ChevronRight className="size-4" />
						</button>
					</>
				) : null}

				<div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2.5 pt-8 pb-2.5 text-white">
					<div className="min-w-0">
						<div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-white/70">
							<span className="inline-flex items-center gap-1 rounded bg-white/15 px-1.5 py-0.5 normal-case tracking-normal">
								<ActionIcon className="size-3" />
								{active.action ?? "screenshot"}
							</span>
							<span>
								{safeIndex + 1} / {count}
							</span>
							<OutcomeDot outcome={active.outcome} />
						</div>
						<p className="m-0 truncate text-sm font-medium">{active.title}</p>
						{active.note ? <p className="m-0 line-clamp-2 text-xs text-white/75">{active.note}</p> : null}
					</div>
					<div className="pointer-events-auto flex shrink-0 items-center gap-1">
						{count > 1 ? (
							<button
								aria-label={playing ? "Pause slideshow" : "Play slideshow"}
								className="flex size-6 cursor-pointer items-center justify-center rounded-full border-0 bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30"
								onClick={() => setPlaying((value) => !value)}
								type="button">
								{playing ? (
									<Pause className="size-3" fill="currentColor" />
								) : (
									<Play className="size-3" fill="currentColor" />
								)}
							</button>
						) : null}
						<button
							aria-label="Expand screenshot"
							className="flex size-6 cursor-pointer items-center justify-center rounded-full border-0 bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30"
							onClick={() => setExpanded(true)}
							type="button">
							<Maximize2 className="size-3" />
						</button>
					</div>
				</div>
			</div>

			{count > 1 ? (
				<div className="flex gap-1.5 overflow-x-auto px-2 py-2">
					{screenshots.map((shot, index) => (
						<button
							aria-current={index === safeIndex}
							aria-label={`Show screenshot ${index + 1}: ${shot.title}`}
							className={cn(
								"relative h-10 shrink-0 cursor-pointer overflow-hidden rounded border-0 bg-black/30 p-0 ring-2 ring-offset-1 ring-offset-code transition-opacity",
								index === safeIndex ? "ring-border" : "opacity-55 ring-transparent hover:opacity-100",
							)}
							key={shot.id}
							onClick={() => goTo(index)}
							style={{ aspectRatio: "16 / 10" }}
							type="button">
							<img alt="" className="size-full object-cover object-top" src={shot.src} />
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
	)
}

function WorkVerificationLightbox({
	screenshots,
	index,
	onNavigate,
	onClose,
}: {
	screenshots: WorkVerificationScreenshot[]
	index: number
	onNavigate: (index: number) => void
	onClose: () => void
}) {
	const shot = screenshots[index]
	const count = screenshots.length

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose()
			else if (event.key === "ArrowRight") onNavigate(index + 1)
			else if (event.key === "ArrowLeft") onNavigate(index - 1)
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [index, onClose, onNavigate])

	if (!shot) return null

	const navButton =
		"flex size-7 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white hover:bg-white/25"

	return (
		<div
			aria-label={`Screenshot ${index + 1} of ${count}`}
			aria-modal="true"
			className="fixed inset-0 z-50 flex flex-col bg-black/90 p-3 text-white backdrop-blur-sm"
			role="dialog">
			<button
				aria-label="Close screenshot viewer"
				className="absolute inset-0 cursor-zoom-out border-0 bg-transparent"
				onClick={onClose}
				type="button"
			/>
			<div className="pointer-events-none relative z-10 flex min-h-0 flex-1 items-center justify-center">
				<img alt={shot.title} className="max-h-full max-w-full rounded object-contain shadow-2xl" src={shot.src} />
			</div>
			<div className="pointer-events-none relative z-10 mt-2 flex w-full items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="m-0 truncate text-sm font-medium">
						<span className="mr-2 text-white/50">
							{index + 1} / {count}
						</span>
						{shot.title}
					</p>
					{shot.note ? <p className="m-0 truncate text-xs text-white/70">{shot.note}</p> : null}
				</div>
				<div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
					<button
						aria-label="Previous screenshot"
						className={navButton}
						onClick={() => onNavigate(index - 1)}
						type="button">
						<ChevronLeft className="size-4" />
					</button>
					<button
						aria-label="Next screenshot"
						className={navButton}
						onClick={() => onNavigate(index + 1)}
						type="button">
						<ChevronRight className="size-4" />
					</button>
					<button aria-label="Close" className={cn(navButton, "ml-1")} onClick={onClose} type="button">
						<X className="size-4" />
					</button>
				</div>
			</div>
		</div>
	)
}
