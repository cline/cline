"use client";

import type { UxVerificationCheck } from "@cline/shared/browser";
import { AgentUxVerification } from "@cline/ui";
import { type ReactNode, useRef, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import type { ChatMessage } from "@/lib/chat-schema";
import { ArtifactDownload } from "./artifact-download";
import { ArtifactImage } from "./artifact-image";
import { normalizeDisplayValue, parseToolPayload } from "./tool-summaries";

export function UxVerificationMessage({ message }: { message: ChatMessage }) {
	const payload = parseToolPayload(message.content);
	const [expanded, setExpanded] = useState<UxVerificationCheck | null>(null);
	const opener = useRef<HTMLElement | null>(null);
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
							<ArtifactImage
								key={check.id}
								media={check.screenshot}
								sessionId={message.sessionId}
								className="max-h-[70vh] w-full object-contain"
							/>
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
			renderScreenshot={(check, className, presentation) =>
				check.screenshot?.source.type === "artifact" ? (
					<ArtifactImage
						media={check.screenshot}
						sessionId={message.sessionId}
						className={className}
						interactive={presentation !== "thumbnail"}
					/>
				) : undefined
			}
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
