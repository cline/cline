"use client";

import type { HTMLAttributes } from "react";

export interface AgentAttachmentItem {
	id: string;
	label: string;
	mediaType?: string;
	src?: string;
}

export interface AgentAttachmentsProps
	extends Omit<HTMLAttributes<HTMLUListElement>, "children"> {
	attachments: readonly AgentAttachmentItem[];
	disabled?: boolean;
	onRemove?: (id: string) => void;
	variant?: "grid" | "inline";
}

export function AgentAttachments({
	attachments,
	className,
	disabled = false,
	onRemove,
	variant = "grid",
	...props
}: AgentAttachmentsProps) {
	if (attachments.length === 0) return null;
	return (
		<ul
			aria-label="Attachments"
			className={["cline-ui-agent-attachments flex flex-wrap gap-2", className]
				.filter(Boolean)
				.join(" ")}
			{...props}
		>
			{attachments.map((attachment) => (
				<li
					className={[
						"cline-ui-agent-attachments__item relative overflow-hidden border border-cline-ui-border bg-cline-ui-muted",
						variant === "grid"
							? "size-14 rounded-cline-ui-lg"
							: "flex h-8 max-w-48 items-center gap-1.5 rounded-cline-ui-md px-1.5",
					].join(" ")}
					key={attachment.id}
				>
					<AttachmentPreview attachment={attachment} variant={variant} />
					{variant === "inline" ? (
						<span className="min-w-0 flex-1 truncate text-cline-ui-foreground text-cline-ui-xs">
							{attachment.label}
						</span>
					) : null}
					{onRemove ? (
						<button
							aria-label={`Remove ${attachment.label}`}
							className={[
								"cline-ui-agent-attachments__remove inline-flex shrink-0 cursor-pointer items-center justify-center border border-cline-ui-border bg-cline-ui-background text-cline-ui-muted-foreground hover:text-cline-ui-foreground focus-visible:outline-2 focus-visible:outline-cline-ui-ring disabled:cursor-not-allowed disabled:opacity-50",
								variant === "grid"
									? "absolute -right-px -top-px size-5 rounded-bl-cline-ui-md"
									: "size-5 rounded-cline-ui-md",
							].join(" ")}
							disabled={disabled}
							onClick={() => onRemove(attachment.id)}
							type="button"
						>
							<XIcon />
						</button>
					) : null}
				</li>
			))}
		</ul>
	);
}

function AttachmentPreview({
	attachment,
	variant,
}: {
	attachment: AgentAttachmentItem;
	variant: "grid" | "inline";
}) {
	const isImage = attachment.mediaType?.startsWith("image/");
	if (isImage && attachment.src) {
		return (
			<img
				alt={attachment.label}
				className={
					variant === "grid"
						? "size-full object-cover"
						: "size-5 shrink-0 rounded-cline-ui-sm object-cover"
				}
				height={variant === "grid" ? 56 : 20}
				src={attachment.src}
				width={variant === "grid" ? 56 : 20}
			/>
		);
	}
	return (
		<span
			aria-hidden="true"
			className="inline-flex size-5 shrink-0 items-center justify-center text-cline-ui-muted-foreground"
		>
			<PaperclipIcon />
		</span>
	);
}

function PaperclipIcon() {
	return (
		<svg
			aria-hidden="true"
			className="size-3.5"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
		</svg>
	);
}

function XIcon() {
	return (
		<svg
			aria-hidden="true"
			className="size-3"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			<path d="M18 6 6 18M6 6l12 12" />
		</svg>
	);
}
