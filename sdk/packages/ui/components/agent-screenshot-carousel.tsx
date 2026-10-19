"use client";

import {
	Check,
	ChevronLeft,
	ChevronRight,
	Keyboard,
	type LucideIcon,
	Maximize2,
	MonitorSmartphone,
	MousePointerClick,
	MoveVertical,
	Pause,
	Play,
	Rocket,
	ScanEye,
	X,
} from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	useState,
} from "react";

export type AgentScreenshotAction =
	| "launch"
	| "click"
	| "type"
	| "key"
	| "scroll"
	| "resize";

export interface AgentScreenshot {
	id: string;
	/** Host-approved image URL; resolve untrusted sandbox URLs before passing them here. */
	src: string;
	/** What the frame shows or verifies. */
	title: string;
	/** The input sent before capture, such as the typed text or pressed keys. */
	detail?: string;
	action?: AgentScreenshotAction;
	/** The agent's pointer position at capture, as fractions of the image size. */
	pointer?: { x: number; y: number };
	status?: "passed" | "failed";
}

export interface AgentScreenshotCarouselProps {
	screenshots: AgentScreenshot[];
	title?: ReactNode;
	subtitle?: ReactNode;
	autoPlay?: boolean;
	intervalMs?: number;
	/** Narrow hosts (sidebars) get smaller thumbnails and a title-only caption. */
	compact?: boolean;
	/** Shows an expand control; the host owns the lightbox. */
	onExpand?: (screenshot: AgentScreenshot, index: number) => void;
	className?: string;
}

const ACTIONS: Record<AgentScreenshotAction, [LucideIcon, string]> = {
	launch: [Rocket, "Launched"],
	click: [MousePointerClick, "Clicked"],
	type: [Keyboard, "Typed"],
	key: [Keyboard, "Pressed"],
	scroll: [MoveVertical, "Scrolled"],
	resize: [MonitorSmartphone, "Resized to"],
};

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
	);
}

/** Auto-advancing screenshot reel with a story-style progress filmstrip. */
export function AgentScreenshotCarousel({
	screenshots,
	title = "Verified in sandbox",
	subtitle,
	autoPlay = true,
	intervalMs = 4000,
	compact = false,
	onExpand,
	className,
}: AgentScreenshotCarouselProps) {
	const count = screenshots.length;
	const [index, setIndex] = useState(0);
	const [playing, setPlaying] = useState(
		() => autoPlay && !prefersReducedMotion(),
	);
	const [hovered, setHovered] = useState(false);
	const [ratios, setRatios] = useState<Record<string, number>>({});
	if (count === 0) return null;

	const active = Math.min(index, count - 1);
	const shot = screenshots[active];
	const running = playing && !hovered && count > 1;
	const go = (next: number) => setIndex((next + count) % count);
	const passed = screenshots.filter((s) => s.status === "passed").length;
	const failed = screenshots.filter((s) => s.status === "failed").length;
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "ArrowLeft") go(active - 1);
		else if (event.key === "ArrowRight") go(active + 1);
		else if (event.key === " " || event.key === "k")
			setPlaying((value) => !value);
		else return;
		event.preventDefault();
	};
	const [ActionIcon, actionLabel] = shot.action ? ACTIONS[shot.action] : [];

	return (
		<section
			aria-label={typeof title === "string" ? title : "Screenshots"}
			aria-roledescription="carousel"
			className={["cline-ui-shots", className].filter(Boolean).join(" ")}
			data-compact={compact || undefined}
			data-running={running || undefined}
			style={
				{ "--cline-ui-shots-interval": `${intervalMs}ms` } as CSSProperties
			}
		>
			<header className="cline-ui-shots__header">
				<span aria-hidden="true" className="cline-ui-shots__header-icon">
					<ScanEye />
				</span>
				<div className="cline-ui-shots__heading">
					<div className="cline-ui-shots__title">{title}</div>
					{subtitle ? (
						<div className="cline-ui-shots__subtitle">{subtitle}</div>
					) : null}
				</div>
				{failed > 0 || passed > 0 ? (
					<span
						className="cline-ui-shots__summary"
						data-tone={failed > 0 ? "failure" : "success"}
					>
						{failed > 0 ? <X /> : <Check />}
						{failed > 0
							? `${failed} failed`
							: compact
								? `${passed}/${count}`
								: `${passed}/${count} checks passed`}
					</span>
				) : null}
			</header>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: The focusable stage owns carousel keyboard shortcuts. */}
			<div
				className="cline-ui-shots__stage"
				onBlur={() => setHovered(false)}
				onFocus={() => setHovered(true)}
				onKeyDown={onKeyDown}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Arrow keys and Space control the reel.
				tabIndex={0}
			>
				{screenshots.map((item, itemIndex) => (
					// biome-ignore lint/a11y/useSemanticElements: WAI-ARIA carousel slides are role="group" with a slide roledescription.
					<div
						aria-hidden={itemIndex !== active}
						aria-label={`${itemIndex + 1} of ${count}`}
						aria-roledescription="slide"
						className="cline-ui-shots__frame"
						data-active={itemIndex === active || undefined}
						key={item.id}
						role="group"
					>
						<img
							alt=""
							aria-hidden="true"
							className="cline-ui-shots__backdrop"
							src={item.src}
						/>
						<div
							className="cline-ui-shots__canvas"
							style={
								{
									"--cline-ui-shots-ratio": ratios[item.id] ?? 1.6,
								} as CSSProperties
							}
						>
							<img
								alt={item.title}
								className="cline-ui-shots__image"
								draggable={false}
								onLoad={(event) => {
									const { naturalWidth, naturalHeight } = event.currentTarget;
									if (naturalWidth && naturalHeight)
										setRatios((current) => ({
											...current,
											[item.id]: naturalWidth / naturalHeight,
										}));
								}}
								src={item.src}
							/>
							{item.pointer && itemIndex === active ? (
								<span
									aria-hidden="true"
									className="cline-ui-shots__pointer"
									style={{
										left: `${item.pointer.x * 100}%`,
										top: `${item.pointer.y * 100}%`,
									}}
								>
									<span className="cline-ui-shots__ripple" />
									<svg aria-hidden="true" viewBox="0 0 24 24">
										<path d="M5 3l14 8-6.2 1.6L10 19z" />
									</svg>
								</span>
							) : null}
						</div>
					</div>
				))}
				<div
					aria-live={running ? "off" : "polite"}
					className="cline-ui-shots__caption"
					key={shot.id}
				>
					<div className="cline-ui-shots__caption-meta">
						<span className="cline-ui-shots__step">
							{active + 1}/{count}
						</span>
						{ActionIcon ? (
							<span className="cline-ui-shots__action">
								<ActionIcon />
								{actionLabel}
								{shot.detail ? <code>{shot.detail}</code> : null}
							</span>
						) : null}
					</div>
					<div className="cline-ui-shots__caption-title">
						{shot.status ? (
							<span
								className="cline-ui-shots__status"
								data-tone={shot.status === "failed" ? "failure" : "success"}
							>
								{shot.status === "failed" ? <X /> : <Check />}
							</span>
						) : null}
						{shot.title}
					</div>
				</div>
				{count > 1 ? (
					<>
						<button
							aria-label="Previous screenshot"
							className="cline-ui-shots__nav"
							data-side="previous"
							onClick={() => go(active - 1)}
							tabIndex={-1}
							type="button"
						>
							<ChevronLeft />
						</button>
						<button
							aria-label="Next screenshot"
							className="cline-ui-shots__nav"
							data-side="next"
							onClick={() => go(active + 1)}
							tabIndex={-1}
							type="button"
						>
							<ChevronRight />
						</button>
					</>
				) : null}
				{onExpand ? (
					<button
						aria-label="Expand screenshot"
						className="cline-ui-shots__expand"
						onClick={() => onExpand(shot, active)}
						type="button"
					>
						<Maximize2 />
					</button>
				) : null}
			</div>
			<div className="cline-ui-shots__filmstrip">
				<div
					aria-label="Screenshots"
					className="cline-ui-shots__thumbs"
					role="tablist"
				>
					{screenshots.map((item, itemIndex) => (
						<button
							aria-label={`Show screenshot ${itemIndex + 1}: ${item.title}`}
							aria-selected={itemIndex === active}
							className="cline-ui-shots__thumb"
							data-state={
								itemIndex < active
									? "past"
									: itemIndex === active
										? "active"
										: "future"
							}
							key={item.id}
							onClick={() => go(itemIndex)}
							role="tab"
							type="button"
						>
							<img alt="" src={item.src} />
							<span className="cline-ui-shots__progress">
								<span
									className="cline-ui-shots__progress-fill"
									key={itemIndex === active ? `active-${active}` : "idle"}
									onAnimationEnd={
										itemIndex === active ? () => go(active + 1) : undefined
									}
								/>
							</span>
						</button>
					))}
				</div>
				{count > 1 ? (
					<button
						aria-label={playing ? "Pause slideshow" : "Play slideshow"}
						className="cline-ui-shots__play"
						onClick={() => setPlaying((value) => !value)}
						type="button"
					>
						{playing ? <Pause /> : <Play />}
					</button>
				) : null}
			</div>
		</section>
	);
}
