"use client";

// Styled composition of shadcn/ui's Message Scroller. The upstream primitive
// owns anchoring, streamed output, visibility tracking, and scroll commands.
import { MessageScroller as Primitive } from "@shadcn/react/message-scroller";
import { clsx } from "clsx";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

export {
	useMessageScroller,
	useMessageScrollerScrollable,
	useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";

export type MessageScrollerProviderProps = ComponentProps<
	typeof Primitive.Provider
>;
export type MessageScrollerProps = ComponentProps<typeof Primitive.Root>;
export type MessageScrollerViewportProps = ComponentProps<
	typeof Primitive.Viewport
>;
export type MessageScrollerContentProps = ComponentProps<
	typeof Primitive.Content
>;
export type MessageScrollerItemProps = ComponentProps<typeof Primitive.Item>;
export type MessageScrollerButtonProps = ComponentProps<
	typeof Primitive.Button
>;

export const MessageScrollerProvider = Primitive.Provider;

export function MessageScroller({ className, ...props }: MessageScrollerProps) {
	return (
		<Primitive.Root
			data-slot="message-scroller"
			className={clsx("cline-message-scroller", className)}
			{...props}
		/>
	);
}

export function MessageScrollerViewport({
	className,
	...props
}: MessageScrollerViewportProps) {
	return (
		<Primitive.Viewport
			data-slot="message-scroller-viewport"
			className={clsx("cline-message-scroller-viewport", className)}
			{...props}
		/>
	);
}

export function MessageScrollerContent({
	className,
	...props
}: MessageScrollerContentProps) {
	return (
		<Primitive.Content
			data-slot="message-scroller-content"
			className={clsx("cline-message-scroller-content", className)}
			{...props}
		/>
	);
}

export function MessageScrollerItem({
	className,
	...props
}: MessageScrollerItemProps) {
	return (
		<Primitive.Item
			data-slot="message-scroller-item"
			className={clsx("cline-message-scroller-item", className)}
			{...props}
		/>
	);
}

export function MessageScrollerButton({
	behavior,
	direction = "end",
	className,
	children,
	...props
}: MessageScrollerButtonProps) {
	const resolvedBehavior =
		behavior ??
		(typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
			? "auto"
			: "smooth");
	return (
		<Primitive.Button
			data-slot="message-scroller-button"
			behavior={resolvedBehavior}
			direction={direction}
			className={clsx("cline-message-scroller-button", className)}
			{...props}
		>
			{children ?? (
				<>
					<ArrowDownIcon aria-hidden="true" />
					<span className="cline-message-scroller-button-label">
						{direction === "end" ? "Scroll to end" : "Scroll to start"}
					</span>
				</>
			)}
		</Primitive.Button>
	);
}
