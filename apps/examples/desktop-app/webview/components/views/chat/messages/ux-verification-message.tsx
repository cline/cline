"use client";

import type { UxVerificationCheck } from "@cline/shared/browser";
import { AgentUxVerification } from "@cline/ui";
import { useRef, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import type { ChatMessage } from "@/lib/chat-schema";
import { ArtifactImage } from "./artifact-image";
import { normalizeDisplayValue, parseToolPayload } from "./tool-summaries";

export function UxVerificationMessage({ message }: { message: ChatMessage }) {
	const payload = parseToolPayload(message.content);
	const [expanded, setExpanded] = useState<UxVerificationCheck | null>(null);
	const opener = useRef<HTMLElement | null>(null);
	return (
		<>
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
			/>
			<Dialog
				open={expanded !== null}
				onOpenChange={(open) => {
					if (!open) setExpanded(null);
				}}
			>
				<DialogContent
					className="sm:max-w-5xl"
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						opener.current?.focus();
					}}
				>
					<DialogTitle>{expanded?.title}</DialogTitle>
					<DialogDescription>{expanded?.subtitle}</DialogDescription>
					{expanded?.screenshot && (
						<ArtifactImage
							key={expanded.id}
							media={expanded.screenshot}
							sessionId={message.sessionId}
							className="max-h-[70vh] w-full object-contain"
						/>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
