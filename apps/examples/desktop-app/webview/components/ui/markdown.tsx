import { cjk } from "@streamdown/cjk";
import type { ComponentProps, MouseEvent } from "react";
import { memo, useState } from "react";
import {
	type Components,
	type ControlsConfig,
	type ExtraProps,
	type LinkSafetyModalProps,
	Streamdown,
} from "streamdown";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "./alert-dialog";
import { markdownCodeHighlighter } from "./markdown-highlighter";

const streamdownPlugins = { cjk, code: markdownCodeHighlighter };
const streamdownControls = {
	code: { copy: true, download: false },
	mermaid: false,
	table: false,
} satisfies ControlsConfig;

function MarkdownLinkSafetyModal({
	isOpen,
	onClose,
	onConfirm,
	url,
}: LinkSafetyModalProps) {
	return (
		<AlertDialog
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			open={isOpen}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Open external link?</AlertDialogTitle>
					<AlertDialogDescription>
						You are about to leave Cline and visit this address.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="max-h-32 overflow-y-auto wrap-break-word rounded-md bg-muted p-3 font-mono text-sm">
					{url}
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							onConfirm();
							onClose();
						}}
					>
						Open link
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

type MarkdownLinkProps = ComponentProps<"a"> & ExtraProps;

function SafeMarkdownLink({
	children,
	className,
	href,
	node: _node,
	rel: _rel,
	target: _target,
	title,
	...props
}: MarkdownLinkProps) {
	const [isOpen, setIsOpen] = useState(false);
	const isIncomplete = href === "streamdown:incomplete-link";
	const url = isIncomplete ? undefined : href;

	if (!url) {
		return (
			<span
				className={className}
				data-incomplete={isIncomplete}
				data-streamdown="link"
			>
				{children}
			</span>
		);
	}

	const isAppLink =
		url.startsWith("#") ||
		(url.startsWith("/") && !url.startsWith("//")) ||
		url.startsWith("./") ||
		url.startsWith("../") ||
		(!/^[a-z][a-z\d+.-]*:/i.test(url) && !url.startsWith("//"));

	if (isAppLink) {
		return (
			<a
				{...props}
				className={`wrap-anywhere font-medium text-primary underline ${className ?? ""}`}
				data-streamdown="link"
				href={url}
				title={title}
			>
				{children}
			</a>
		);
	}

	const openConfirmation = (event: MouseEvent<HTMLAnchorElement>) => {
		event.preventDefault();
		setIsOpen(true);
	};
	const confirmMiddleClick = (event: MouseEvent<HTMLAnchorElement>) => {
		if (event.button === 1) openConfirmation(event);
	};

	return (
		<>
			{/* biome-ignore lint/a11y/useValidAnchor: External Markdown retains native link semantics while confirmation withholds the live destination. */}
			<a
				{...props}
				aria-haspopup="dialog"
				className={`wrap-anywhere font-medium text-primary underline ${className ?? ""}`}
				data-streamdown="link"
				href="#confirm-external-link"
				onAuxClick={confirmMiddleClick}
				onClick={openConfirmation}
				title={title ?? url}
			>
				{children}
			</a>
			<MarkdownLinkSafetyModal
				isOpen={isOpen}
				onClose={() => setIsOpen(false)}
				onConfirm={() => window.open(url, "_blank", "noreferrer")}
				url={url}
			/>
		</>
	);
}

type MarkdownImageProps =
	| (ComponentProps<"img"> & ExtraProps)
	| (Record<string, unknown> & ExtraProps);

const remoteImagePattern = /^(?:https?:)?[\\/]{2}/i;

function isSafeMarkdownImageSource(source: string): boolean {
	const normalized = source.trim();
	if (!normalized || remoteImagePattern.test(normalized)) return false;

	// Streamdown's hardened URL policy accepts app-root paths. Keeping the rule
	// this narrow prevents model-authored Markdown from making hidden requests.
	return normalized.startsWith("/");
}

function MarkdownImage({ alt, height, src, title, width }: MarkdownImageProps) {
	const label = typeof alt === "string" ? alt.trim() : "";
	const source = typeof src === "string" ? src.trim() : "";

	if (source && isSafeMarkdownImageSource(source)) {
		return (
			// biome-ignore lint/performance/noImgElement: Markdown can reference runtime app assets that Next Image cannot statically optimize.
			<img
				alt={label}
				className="my-4 max-w-full rounded-lg"
				data-streamdown="image"
				height={typeof height === "number" ? height : undefined}
				loading="lazy"
				src={source}
				title={typeof title === "string" ? title : undefined}
				width={typeof width === "number" ? width : undefined}
			/>
		);
	}

	return (
		<span data-streamdown="blocked-image" role="note">
			External image blocked for privacy{label ? `: ${label}` : ""}
		</span>
	);
}

const markdownComponents = {
	a: SafeMarkdownLink,
	img: MarkdownImage,
} satisfies Components;

export const MemoizedMarkdown = memo(
	({
		content,
		streaming = false,
	}: {
		content: string;
		streaming?: boolean;
	}) => (
		<Streamdown
			className="cline-markdown"
			components={markdownComponents}
			controls={streamdownControls}
			dir="auto"
			isAnimating={streaming}
			lineNumbers
			mode={streaming ? "streaming" : "static"}
			normalizeHtmlIndentation
			parseIncompleteMarkdown={streaming}
			plugins={streamdownPlugins}
		>
			{content}
		</Streamdown>
	),
);

MemoizedMarkdown.displayName = "MemoizedMarkdown";
