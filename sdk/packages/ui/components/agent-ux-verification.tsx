"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
	Check,
	CircleAlert,
	Expand,
	LoaderCircle,
	Pause,
	Play,
	ShieldCheck,
	X,
} from "lucide-react";
import {
	UxVerificationReportSchema,
	type UxVerificationCheck,
} from "@cline/shared/browser";
import { GeneratedMediaContent } from "./generated-media.js";
import { clsx as cn } from "clsx";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
	CarouselNext,
	CarouselPrevious,
	type CarouselApi,
} from "./carousel.js";

export type UxScreenshotPresentation = "slide" | "thumbnail";
export type UxScreenshotRenderer = (
	check: UxVerificationCheck,
	className: string | undefined,
	presentation: UxScreenshotPresentation,
) => ReactNode;

function EvidenceImage({
	check,
	className,
	renderScreenshot,
	presentation,
}: {
	check: UxVerificationCheck;
	className?: string;
	renderScreenshot?: UxScreenshotRenderer;
	presentation: UxScreenshotPresentation;
}) {
	const image = check.screenshot;
	const [failedImage, setFailedImage] = useState<typeof image>();
	if (image && renderScreenshot) {
		const rendered = renderScreenshot(check, className, presentation);
		if (rendered !== undefined) return rendered;
	}
	if (image?.source.type === "base64" && failedImage !== image)
		return (
			<div className={className} onErrorCapture={() => setFailedImage(image)}>
				<GeneratedMediaContent
					className={className}
					media={{ ...image, name: image.name ?? check.title }}
				/>
			</div>
		);
	return (
		<div className={cn("cline-ui-ux-evidence-missing", className)}>
			<CircleAlert className="size-7" />
			<span>
				{failedImage && failedImage === image
					? "Screenshot could not be loaded"
					: image
						? "Screenshot requires a host image resolver"
						: "No screenshot available"}
			</span>
		</div>
	);
}

export interface AgentUxVerificationProps {
	output: unknown;
	state: "running" | "completed" | "error";
	error?: string;
	/** Thumbnail renderers must not contain interactive controls. Return undefined
	 * to use the default renderer (including its inline image error handling). */
	renderScreenshot?: UxScreenshotRenderer;
	/** The host owns its focus-managed image viewer. */
	onExpandScreenshot?: (check: UxVerificationCheck) => void;
}

function StatusIcon({ status }: { status: UxVerificationCheck["status"] }) {
	const Icon =
		status === "passed" ? Check : status === "failed" ? X : CircleAlert;
	return (
		<span
			className={cn("cline-ui-ux-status-icon", `cline-ui-ux-status-${status}`)}
		>
			<Icon className="size-3.5" />
		</span>
	);
}
export function AgentUxVerification({
	output,
	state,
	error,
	renderScreenshot,
	onExpandScreenshot,
}: AgentUxVerificationProps) {
	const [api, setApi] = useState<CarouselApi>();
	const [selected, setSelected] = useState(0);
	const [playing, setPlaying] = useState(false);
	const parsed = useMemo(
		() => UxVerificationReportSchema.safeParse(output),
		[output],
	);
	const report = parsed.success ? parsed.data : null;
	useEffect(() => {
		if (!api) return;
		const select = () => setSelected(api.selectedScrollSnap());
		select();
		api.on("select", select);
		api.on("reInit", select);
		return () => {
			api.off("select", select);
			api.off("reInit", select);
		};
	}, [api]);
	useEffect(() => {
		if (!api || !playing) return;
		const timer = setInterval(() => {
			if (api.canScrollNext()) api.scrollNext();
			else api.scrollTo(0);
		}, 5000);
		return () => clearInterval(timer);
	}, [api, playing]);
	if (state !== "completed" || !report) {
		const pending = state === "running";
		return (
			<div
				data-slot="cline-ui-ux-verifier"
				className="cline-ui-ux-verifier cline-ui-ux-verifier-pending"
				role={pending ? "status" : "alert"}
			>
				{pending ? (
					<LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
				) : (
					<CircleAlert className="size-5" />
				)}
				<div>
					<strong>
						{pending
							? "Verifying UX"
							: "UX verification could not be completed"}
					</strong>
					<p>
						{pending
							? "Walking through the checklist and capturing evidence."
							: typeof error === "string"
								? error
								: "The verifier did not return a valid evidence report."}
					</p>
				</div>
			</div>
		);
	}
	const passed = report.checks.filter(
		(check) => check.status === "passed",
	).length;
	const current = report.checks[Math.min(selected, report.checks.length - 1)];
	const select = (index: number) => {
		setPlaying(false);
		api?.scrollTo(index);
	};
	return (
		<section
			data-slot="cline-ui-ux-verifier"
			className="cline-ui-ux-verifier"
			aria-label={report.title}
		>
			<header className="cline-ui-ux-verifier-header">
				<span className="cline-ui-ux-verifier-mark">
					<ShieldCheck className="size-5" />
				</span>
				<div className="min-w-0 flex-1">
					<h3>{report.title}</h3>
					<p>{report.subtitle}</p>
				</div>
				<span
					className={cn(
						"cline-ui-ux-verifier-count",
						passed === report.checks.length && "all-passed",
					)}
				>
					<Check className="size-3.5" />
					{passed}/{report.checks.length} checks passed
				</span>
			</header>
			<Carousel
				setApi={setApi}
				aria-label="UX verification evidence"
				className="cline-ui-ux-evidence-carousel"
				onPointerDown={() => setPlaying(false)}
				aria-keyshortcuts="ArrowLeft ArrowRight Space"
				onKeyDownCapture={(event) => {
					if (event.altKey || event.ctrlKey || event.metaKey) return;
					if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
						setPlaying(false);
					}
					// Buttons keep their native Space activation; the focused carousel
					// uses Space to toggle playback without scrolling the page.
					if (
						event.key === " " &&
						event.target === event.currentTarget &&
						report.checks.length > 1
					) {
						event.preventDefault();
						if (!event.repeat) setPlaying((value) => !value);
					}
				}}
			>
				<CarouselContent>
					{report.checks.map((check, index) => (
						<CarouselItem
							key={check.id}
							aria-label={`${index + 1} of ${report.checks.length}`}
						>
							<figure className="cline-ui-ux-evidence-slide">
								<EvidenceImage
									presentation="slide"
									renderScreenshot={renderScreenshot}
									check={check}
									className="cline-ui-ux-evidence-image"
								/>
								<figcaption className="cline-ui-ux-evidence-caption">
									<div className="cline-ui-ux-evidence-action">
										<span>
											{index + 1}/{report.checks.length}
										</span>
										{check.action && <span>{check.action}</span>}
									</div>
									<h4>
										<StatusIcon status={check.status} />
										{check.title}
									</h4>
									<p>{check.subtitle}</p>
								</figcaption>
							</figure>
						</CarouselItem>
					))}
				</CarouselContent>
				<button
					type="button"
					disabled={!current.screenshot || !onExpandScreenshot}
					onClick={() => {
						setPlaying(false);
						onExpandScreenshot?.(current);
					}}
					className="cline-ui-ux-evidence-expand"
					aria-label="Expand screenshot"
					title="Expand screenshot"
				>
					<Expand className="size-4" />
				</button>
				{report.checks.length > 1 && (
					<>
						<CarouselPrevious
							disabled={selected === 0}
							className="cline-ui-ux-evidence-prev"
							onClick={() => setPlaying(false)}
						/>
						<CarouselNext
							disabled={selected === report.checks.length - 1}
							className="cline-ui-ux-evidence-next"
							onClick={() => setPlaying(false)}
						/>
					</>
				)}
			</Carousel>
			<footer className="cline-ui-ux-evidence-footer">
				{/* biome-ignore lint/a11y/useSemanticElements: fieldset would break layout styling */}
				<div
					className="cline-ui-ux-evidence-thumbnails"
					role="group"
					aria-label="Choose verification check"
				>
					{report.checks.map((check, index) => (
						<button
							type="button"
							key={check.id}
							className={cn(
								"cline-ui-ux-evidence-thumbnail",
								selected === index && "selected",
							)}
							aria-label={`Show check ${index + 1}: ${check.title}`}
							aria-current={selected === index ? "true" : undefined}
							onClick={() => select(index)}
						>
							<EvidenceImage
								presentation="thumbnail"
								renderScreenshot={renderScreenshot}
								check={check}
							/>
							<span className="cline-ui-ux-thumbnail-status">
								<StatusIcon status={check.status} />
							</span>
						</button>
					))}
				</div>
				{report.checks.length > 1 && (
					<button
						type="button"
						className="cline-ui-ux-evidence-play"
						onClick={() => setPlaying((value) => !value)}
						aria-label={playing ? "Pause slideshow" : "Play slideshow"}
						aria-pressed={playing}
					>
						{playing ? (
							<Pause className="size-4" />
						) : (
							<Play className="size-4" />
						)}
					</button>
				)}
			</footer>
			<p className="sr-only" aria-live={playing ? "off" : "polite"}>
				Check {selected + 1} of {report.checks.length}: {current.title}.{" "}
				{current.status}. {current.subtitle}
			</p>
		</section>
	);
}
