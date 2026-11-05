"use client";

import type { UxVerificationCheck } from "@cline/shared/browser";
import { AgentUxVerification } from "@cline/ui";
import { type ReactNode, useContext, useRef, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import type { ChatMessage } from "@/lib/chat-schema";
import { ArtifactDownload } from "./artifact-download";
import { ArtifactImage } from "./artifact-image";
import {
	AnnotatableScreenshot,
	ScreenshotFeedbackContext,
} from "./screenshot-annotator";
import { normalizeDisplayValue, parseToolPayload } from "./tool-summaries";

export function UxVerificationMessage({ message }: { message: ChatMessage }) {
	const payload = parseToolPayload(message.content);
	const [expanded, setExpanded] = useState<UxVerificationCheck | null>(null);
	const opener = useRef<HTMLElement | null>(null);
	const feedback = useContext(ScreenshotFeedbackContext);
	const annotatable = (check: UxVerificationCheck, className: string) =>
		feedback &&
		message.sessionId &&
		check.screenshot?.source.type === "artifact" ? (
			<AnnotatableScreenshot
				feedback={feedback}
				media={check.screenshot}
				artifactId={check.screenshot.source.artifactId}
				sessionId={message.sessionId}
				title={check.title}
				className={className}
			/>
		) : null;
	const noteCount = (check: UxVerificationCheck) =>
		feedback?.notes.filter(
			(note) =>
				check.screenshot?.source.type === "artifact" &&
				note.sessionId === message.sessionId &&
				note.artifactId === check.screenshot.source.artifactId,
		).length ?? 0;
	const viewer = (check: UxVerificationCheck, control?: ReactNode) =>
		expanded?.id === check.id ? (
			<Dialog
				open
				onOpenChange={(open) => {
					if (!open) setExpanded(null);
				}}
			>
				<DialogContent
					className="sm:max-w-5xl"
					onKeyDown={(event) => event.stopPropagation()}
					onEscapeKeyDown={(event) => {
						// Escape cancels an open feedback note instead of closing the viewer.
						if (event.target instanceof HTMLTextAreaElement)
							event.preventDefault();
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						opener.current?.focus();
					}}
				>
					<DialogTitle>{check.title}</DialogTitle>
					<DialogDescription>{check.subtitle}</DialogDescription>
					{check.screenshot && (
						<div className="relative">
							<div className="absolute right-3 top-3 z-10">{control}</div>
							{annotatable(check, "aspect-[16/10] max-h-[70vh] w-full") ?? (
								<ArtifactImage
									key={check.id}
									media={check.screenshot}
									sessionId={message.sessionId}
									className="max-h-[70vh] w-full object-contain"
								/>
							)}
						</div>
					)}
				</DialogContent>
			</Dialog>
		) : null;
	const download = (check: UxVerificationCheck) =>
		check.screenshot?.source.type === "artifact" && message.sessionId ? (
			<ArtifactDownload
				sessionId={message.sessionId}
				artifactId={check.screenshot.source.artifactId}
				iconOnly
				className="cline-ui-ux-evidence-download"
			>
				{(control) => viewer(check, control)}
			</ArtifactDownload>
		) : (
			viewer(check)
		);
	return (
		<AgentUxVerification
			output={normalizeDisplayValue(payload?.result)}
			state={payload?.isError ? "error" : "completed"}
			error={
				payload?.isError
					? "The UX verification report could not be completed."
					: undefined
			}
			renderScreenshot={(check, className, presentation) => {
				if (check.screenshot?.source.type !== "artifact") return undefined;
				if (presentation === "slide") {
					const slide = annotatable(check, className ?? "");
					if (slide) return slide;
				}
				const image = (
					<ArtifactImage
						media={check.screenshot}
						sessionId={message.sessionId}
						className={className}
						interactive={presentation !== "thumbnail"}
					/>
				);
				if (presentation !== "thumbnail" || !feedback) return image;
				const count = noteCount(check);
				return (
					<span className="relative block size-full">
						{image}
						{count > 0 ? (
							<span className="absolute left-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
								{count}
							</span>
						) : null}
					</span>
				);
			}}
			onExpandScreenshot={(check) => {
				opener.current =
					document.activeElement instanceof HTMLElement
						? document.activeElement
						: null;
				setExpanded(check);
			}}
			renderScreenshotActions={download}
		/>
	);
}
