"use client";

import type { UxScreenshot } from "@cline/shared/browser";
import { MousePointer2, X } from "lucide-react";
import {
	type CSSProperties,
	createContext,
	type PointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import type { ScreenshotNote } from "@/lib/screenshot-feedback";
import { cn } from "@/lib/utils";
import { ArtifactImage } from "./artifact-image";

export type ScreenshotFeedback = {
	notes: ScreenshotNote[];
	saveNote: (note: ScreenshotNote) => void;
	removeNote: (id: string) => void;
};

/** Present only where notes can be sent from the composer. */
export const ScreenshotFeedbackContext =
	createContext<ScreenshotFeedback | null>(null);

type Draft = Pick<ScreenshotNote, "x" | "y" | "width" | "height" | "text"> & {
	id?: string;
};
type Point = { x: number; y: number };

const DRAG_THRESHOLD_PX = 6;
const bubbleClassName =
	"absolute w-max max-w-[220px] rounded-lg border border-white/15 bg-[#191b28eb] text-[11px] leading-[15px] text-white shadow-lg backdrop-blur-sm";

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const pct = (value: number) => `${value * 100}%`;

/** Opens toward the roomier side so bubbles stay inside the clipped slide. */
function bubblePosition(note: Draft): CSSProperties {
	const right = note.x + (note.width ?? 0);
	return {
		...(right < 0.6
			? { left: `calc(${pct(right)} + 16px)` }
			: { right: `calc(${pct(1 - note.x)} + 16px)` }),
		...(note.y < 0.7
			? { top: `calc(${pct(note.y)} - 12px)` }
			: { bottom: `calc(${pct(1 - note.y)} - 12px)` }),
	};
}

function Marker({ note, number }: { note: Draft; number: number }) {
	return (
		<>
			{note.width && note.height ? (
				<span
					className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/10 shadow-[0_0_0_1px_white]"
					style={{
						left: pct(note.x),
						top: pct(note.y),
						width: pct(note.width),
						height: pct(note.height),
					}}
				/>
			) : null}
			<span
				className="pointer-events-none absolute grid size-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-primary text-[11px] font-semibold text-primary-foreground shadow-md"
				style={{ left: pct(note.x), top: pct(note.y) }}
			>
				{number}
			</span>
		</>
	);
}

export function AnnotatableScreenshot({
	feedback,
	media,
	artifactId,
	sessionId,
	title,
	className,
}: {
	feedback: ScreenshotFeedback;
	media: UxScreenshot;
	artifactId: string;
	sessionId: string;
	title: string;
	className?: string;
}) {
	const frame = useRef<HTMLDivElement>(null);
	const [ratio, setRatio] = useState(16 / 9);
	const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null);
	const [draft, setDraftState] = useState<Draft | null>(null);
	const draftRef = useRef<Draft | null>(null);
	const setDraft = (next: Draft | null) => {
		draftRef.current = next;
		setDraftState(next);
	};
	const notes = feedback.notes
		.map((note, index) => ({ note, number: index + 1 }))
		.filter(
			({ note }) =>
				note.sessionId === sessionId && note.artifactId === artifactId,
		);

	useEffect(() => {
		const element = frame.current;
		if (!element) return;
		const onLoad = (event: Event) => {
			const image = event.target;
			if (image instanceof HTMLImageElement && image.naturalHeight > 0) {
				setRatio(image.naturalWidth / image.naturalHeight);
			}
		};
		// Image load events do not bubble, so listen during capture.
		element.addEventListener("load", onLoad, true);
		// The carousel starts a slide drag from these; React handlers here use
		// the capture phase, which runs before this stops them.
		const stop = (event: Event) => event.stopPropagation();
		const dragStarts = ["pointerdown", "mousedown", "touchstart"] as const;
		for (const type of dragStarts) element.addEventListener(type, stop);
		return () => {
			element.removeEventListener("load", onLoad, true);
			for (const type of dragStarts) element.removeEventListener(type, stop);
		};
	}, []);

	const pointAt = (event: PointerEvent): Point => {
		const rect = event.currentTarget.getBoundingClientRect();
		return {
			x: clamp((event.clientX - rect.left) / rect.width),
			y: clamp((event.clientY - rect.top) / rect.height),
		};
	};
	const commit = () => {
		const current = draftRef.current;
		setDraft(null);
		const text = current?.text.trim();
		if (!current || !text) return;
		feedback.saveNote({
			id: current.id ?? crypto.randomUUID(),
			sessionId,
			artifactId,
			screenshotTitle: title,
			x: current.x,
			y: current.y,
			width: current.width,
			height: current.height,
			text,
		});
	};

	const preview = drag && {
		x: Math.min(drag.start.x, drag.end.x),
		y: Math.min(drag.start.y, drag.end.y),
		width: Math.abs(drag.end.x - drag.start.x),
		height: Math.abs(drag.end.y - drag.start.y),
	};

	return (
		<div
			className={className}
			style={{ display: "grid", placeItems: "center", containerType: "size" }}
		>
			<div
				ref={frame}
				className="group/annotate relative"
				style={{
					aspectRatio: ratio,
					width: `min(100cqw, 100cqh * ${ratio})`,
				}}
			>
				<ArtifactImage
					media={media}
					sessionId={sessionId}
					className="size-full object-contain"
				/>
				<div
					data-slot="screenshot-feedback-surface"
					className="absolute inset-0 cursor-crosshair"
					onPointerDownCapture={(event) => {
						if (event.button !== 0) return;
						event.currentTarget.setPointerCapture?.(event.pointerId);
						const point = pointAt(event);
						setDrag({ start: point, end: point });
					}}
					onPointerMove={(event) => {
						if (drag) setDrag({ ...drag, end: pointAt(event) });
					}}
					onPointerUp={(event) => {
						if (!drag) return;
						const end = pointAt(event);
						const rect = event.currentTarget.getBoundingClientRect();
						const isBox =
							Math.abs(end.x - drag.start.x) * rect.width > DRAG_THRESHOLD_PX &&
							Math.abs(end.y - drag.start.y) * rect.height > DRAG_THRESHOLD_PX;
						setDrag(null);
						setDraft(
							isBox
								? {
										x: Math.min(drag.start.x, end.x),
										y: Math.min(drag.start.y, end.y),
										width: Math.abs(end.x - drag.start.x),
										height: Math.abs(end.y - drag.start.y),
										text: "",
									}
								: { ...drag.start, text: "" },
						);
					}}
					onPointerCancel={() => setDrag(null)}
				/>
				{preview && preview.width > 0 && preview.height > 0 ? (
					<span
						className="pointer-events-none absolute rounded-sm border-2 border-dashed border-white bg-white/10"
						style={{
							left: pct(preview.x),
							top: pct(preview.y),
							width: pct(preview.width),
							height: pct(preview.height),
						}}
					/>
				) : null}
				{notes.map(({ note, number }) =>
					note.id === draft?.id ? null : (
						<div key={note.id}>
							<Marker note={note} number={number} />
							<div
								className={cn(bubbleClassName, "group/note flex items-start")}
								style={bubblePosition(note)}
							>
								<button
									type="button"
									className="min-w-0 px-2.5 py-1.5 text-left"
									title="Edit note"
									onClick={() => setDraft(note)}
								>
									{note.text}
								</button>
								<button
									type="button"
									aria-label={`Remove note ${number}`}
									className="shrink-0 p-1.5 text-white/50 opacity-0 transition-opacity hover:text-white focus-visible:opacity-100 group-hover/note:opacity-100"
									onClick={() => feedback.removeNote(note.id)}
								>
									<X className="size-3" />
								</button>
							</div>
						</div>
					),
				)}
				{draft ? (
					<>
						<Marker
							note={draft}
							number={
								notes.find(({ note }) => note.id === draft.id)?.number ??
								feedback.notes.length + 1
							}
						/>
						<div
							className={cn(bubbleClassName, "w-[240px] p-2")}
							style={bubblePosition(draft)}
						>
							<textarea
								// biome-ignore lint/a11y/noAutofocus: the editor opens in response to the click that placed it
								autoFocus
								aria-label="Feedback note"
								className="field-sizing-content min-h-9 w-full resize-none rounded-md bg-white/10 px-2 py-1.5 outline-none placeholder:text-white/45"
								placeholder="What should change here?"
								value={draft.text}
								onChange={(event) =>
									setDraft({ ...draft, text: event.target.value })
								}
								onBlur={commit}
								onKeyDown={(event) => {
									event.stopPropagation();
									if (event.key === "Escape") {
										event.preventDefault();
										setDraft(null);
									} else if (
										event.key === "Enter" &&
										!event.shiftKey &&
										!event.nativeEvent.isComposing
									) {
										event.preventDefault();
										commit();
									}
								}}
							/>
							<div className="mt-1 flex justify-between text-[10px] text-white/45">
								<span>Esc to cancel</span>
								<span>Enter to add</span>
							</div>
						</div>
					</>
				) : drag || notes.length > 0 ? null : (
					<span
						className={cn(
							bubbleClassName,
							"pointer-events-none bottom-2 left-2 flex items-center gap-1.5 rounded-full px-2.5 py-1 opacity-0 transition-opacity group-hover/annotate:opacity-100",
						)}
					>
						<MousePointer2 className="size-3" />
						Click or drag to add feedback
					</span>
				)}
			</div>
		</div>
	);
}
