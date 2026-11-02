"use client";

import { clsx } from "clsx";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
	useState,
} from "react";

/** Presentation only. Hosts retain drafts, input events, menus, and runtime actions. */
export type AgentComposerVariant = "welcome" | "conversation";
type VariantProps = { variant?: AgentComposerVariant };

const AgentComposerVariantContext =
	createContext<AgentComposerVariant>("conversation");

function useAgentComposerVariant(variant?: AgentComposerVariant) {
	const inheritedVariant = useContext(AgentComposerVariantContext);
	return variant ?? inheritedVariant;
}

export type AgentComposerProps = ComponentPropsWithoutRef<"div"> & VariantProps;

export const AgentComposer = forwardRef<HTMLDivElement, AgentComposerProps>(
	function AgentComposer(
		{ variant = "conversation", className, ...props },
		ref,
	) {
		return (
			<AgentComposerVariantContext.Provider value={variant}>
				<div
					{...props}
					ref={ref}
					className={clsx(
						variant === "welcome"
							? "overflow-visible rounded-cline-ui-xl border border-cline-ui-border/90 bg-cline-ui-surface-1/40 shadow-[0_24px_80px_-56px_color-mix(in_oklab,var(--primary)_72%,transparent)] backdrop-blur-md"
							: "overflow-visible rounded-cline-ui-xl border border-cline-ui-border bg-cline-ui-surface-2 backdrop-blur-sm focus-within:border-cline-ui-primary/50 focus-within:ring-1 focus-within:ring-cline-ui-primary/20",
						className,
					)}
				/>
			</AgentComposerVariantContext.Provider>
		);
	},
);

export type AgentComposerBodyProps = ComponentPropsWithoutRef<"div"> &
	VariantProps & { hasQueue?: boolean };

export const AgentComposerBody = forwardRef<
	HTMLDivElement,
	AgentComposerBodyProps
>(function AgentComposerBody(
	{ variant: variantProp, hasQueue = false, className, ...props },
	ref,
) {
	const variant = useAgentComposerVariant(variantProp);
	return (
		<div
			{...props}
			ref={ref}
			className={clsx(
				variant === "welcome"
					? "px-4 py-3 pb-2 pt-4"
					: hasQueue
						? "px-4 py-3 pb-4 pt-0"
						: "px-4 py-4",
				className,
			)}
		/>
	);
});

export type AgentComposerFieldProps = ComponentPropsWithoutRef<"div"> &
	VariantProps;

export const AgentComposerField = forwardRef<
	HTMLDivElement,
	AgentComposerFieldProps
>(function AgentComposerField(
	{ variant: variantProp, className, ...props },
	ref,
) {
	const variant = useAgentComposerVariant(variantProp);
	return (
		<div
			{...props}
			ref={ref}
			className={clsx(
				variant === "welcome"
					? "flex items-end gap-2 border-cline-ui-border focus-within:border-cline-ui-primary/50 focus-within:ring-cline-ui-primary/20 min-h-16 rounded-none border-0 bg-transparent px-0 py-0 focus-within:ring-0"
					: "flex gap-2 border-cline-ui-border focus-within:ring-cline-ui-primary/20 min-h-24 items-start rounded-none border-0 bg-transparent px-0 py-0 focus-within:border-transparent focus-within:ring-0",
				className,
			)}
		/>
	);
});

/** Chip style for composer tokens; hosts reuse it where sent messages echo them. */
export const agentComposerTokenClassName =
	"-mx-0.5 rounded-cline-ui-md bg-cline-ui-primary/25 px-0.5 py-px inset-ring inset-ring-cline-ui-primary/50";

export type AgentComposerTextareaProps = ComponentPropsWithoutRef<"textarea"> &
	VariantProps & {
		/**
		 * Sorted, non-overlapping `[start, end)` ranges of `value` drawn as inline
		 * tokens (slash commands, file mentions). Backspace at a token's end or
		 * Delete at its start removes the whole token.
		 */
		highlights?: { start: number; end: number }[];
	};

export const AgentComposerTextarea = forwardRef<
	HTMLTextAreaElement,
	AgentComposerTextareaProps
>(function AgentComposerTextarea(
	{
		variant: variantProp,
		className,
		highlights,
		onKeyDown,
		onScroll,
		...props
	},
	ref,
) {
	const variant = useAgentComposerVariant(variantProp);
	const [scrollTop, setScrollTop] = useState(0);
	const value = typeof props.value === "string" ? props.value : "";
	let renderedUpTo = 0;
	// The wrapper is always rendered so toggling the highlight never remounts
	// (and blurs) the textarea mid-typing. Both layers reserve the scrollbar
	// gutter so text wraps identically once the textarea scrolls.
	return (
		<div
			className={clsx(
				"relative flex min-w-0 flex-1",
				variant === "welcome" && "self-start",
			)}
		>
			{highlights && highlights.length > 0 && (
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 overflow-y-hidden [scrollbar-gutter:stable] whitespace-pre-wrap break-words text-cline-ui-sm leading-5 text-transparent"
				>
					<div style={{ transform: `translateY(${-scrollTop}px)` }}>
						{highlights.map(({ start, end }) => {
							const before = value.slice(renderedUpTo, start);
							renderedUpTo = end;
							return [
								before,
								<span className={agentComposerTokenClassName} key={start}>
									{value.slice(start, end)}
								</span>,
							];
						})}
					</div>
				</div>
			)}
			<textarea
				{...props}
				ref={ref}
				onKeyDown={(event) => {
					onKeyDown?.(event);
					const textarea = event.currentTarget;
					if (
						event.defaultPrevented ||
						event.nativeEvent.isComposing ||
						event.altKey ||
						event.ctrlKey ||
						event.metaKey ||
						textarea.selectionStart !== textarea.selectionEnd
					) {
						return;
					}
					const caret = textarea.selectionStart;
					const token = highlights?.find((range) =>
						event.key === "Backspace"
							? range.end === caret
							: event.key === "Delete" && range.start === caret,
					);
					// Selecting the token lets the native delete remove it, keeping undo intact.
					if (token) textarea.setSelectionRange(token.start, token.end);
				}}
				onScroll={(event) => {
					setScrollTop(event.currentTarget.scrollTop);
					onScroll?.(event);
				}}
				className={clsx(
					"relative field-sizing-content flex-1 resize-none overflow-y-auto [scrollbar-gutter:stable] bg-transparent text-cline-ui-sm leading-5 text-cline-ui-foreground placeholder:text-cline-ui-muted-foreground outline-none",
					className,
				)}
			/>
		</div>
	);
});

export type AgentComposerActionsProps = ComponentPropsWithoutRef<"div"> &
	VariantProps;

export const AgentComposerActions = forwardRef<
	HTMLDivElement,
	AgentComposerActionsProps
>(function AgentComposerActions(
	{ variant: variantProp, className, ...props },
	ref,
) {
	const variant = useAgentComposerVariant(variantProp);
	return (
		<div
			{...props}
			ref={ref}
			className={clsx(
				variant === "welcome"
					? "flex shrink-0 items-center gap-2"
					: "flex shrink-0 items-center gap-2 self-end",
				className,
			)}
		/>
	);
});

export type AgentComposerStopButtonProps = ComponentPropsWithoutRef<"button"> &
	VariantProps;

export const AgentComposerStopButton = forwardRef<
	HTMLButtonElement,
	AgentComposerStopButtonProps
>(function AgentComposerStopButton(
	{ variant: variantProp, className, ...props },
	ref,
) {
	const variant = useAgentComposerVariant(variantProp);
	return (
		<button
			{...props}
			ref={ref}
			className={clsx(
				variant === "welcome"
					? "bg-cline-ui-foreground p-1.5 text-cline-ui-background hover:bg-cline-ui-destructive rounded-cline-ui-md"
					: "bg-cline-ui-foreground p-1.5 text-cline-ui-background hover:bg-cline-ui-destructive rounded-full",
				className,
			)}
		/>
	);
});

export type AgentComposerSendButtonProps = ComponentPropsWithoutRef<"button"> &
	VariantProps;

export const AgentComposerSendButton = forwardRef<
	HTMLButtonElement,
	AgentComposerSendButtonProps
>(function AgentComposerSendButton(
	{ variant: variantProp, className, ...props },
	ref,
) {
	const variant = useAgentComposerVariant(variantProp);
	return (
		<button
			{...props}
			ref={ref}
			className={clsx(
				variant === "welcome"
					? "p-1.5 disabled:cursor-not-allowed disabled:opacity-50 rounded-cline-ui-md bg-[linear-gradient(145deg,var(--primary-emphasis),var(--primary))] text-white shadow-sm hover:brightness-110"
					: "p-1.5 disabled:cursor-not-allowed disabled:opacity-50 rounded-full bg-cline-ui-primary text-cline-ui-background hover:bg-cline-ui-primary/80",
				className,
			)}
		/>
	);
});

export type AgentComposerAttachmentsProps = ComponentPropsWithoutRef<"div">;

export const AgentComposerAttachments = forwardRef<
	HTMLDivElement,
	AgentComposerAttachmentsProps
>(function AgentComposerAttachments({ className, ...props }, ref) {
	return (
		<div
			{...props}
			ref={ref}
			className={clsx("mt-2 flex flex-wrap gap-1.5", className)}
		/>
	);
});

export type AgentComposerSettingsProps = ComponentPropsWithoutRef<"div">;

export const AgentComposerSettings = forwardRef<
	HTMLDivElement,
	AgentComposerSettingsProps
>(function AgentComposerSettings({ className, ...props }, ref) {
	return (
		<div
			{...props}
			ref={ref}
			className={clsx(
				"flex min-w-0 items-center justify-between gap-x-3 gap-y-2 rounded-b-cline-ui-xl border-t border-cline-ui-border bg-cline-ui-muted/20 px-2 py-2 text-cline-ui-sm text-cline-ui-muted-foreground",
				className,
			)}
		/>
	);
});

export type AgentComposerSettingsGroupProps = ComponentPropsWithoutRef<"div">;

export const AgentComposerSettingsGroup = forwardRef<
	HTMLDivElement,
	AgentComposerSettingsGroupProps
>(function AgentComposerSettingsGroup({ className, ...props }, ref) {
	return (
		<div
			{...props}
			ref={ref}
			className={clsx("flex min-w-0 flex-auto items-center gap-2", className)}
		/>
	);
});

export type AgentComposerSettingsEndProps = ComponentPropsWithoutRef<"div">;

export const AgentComposerSettingsEnd = forwardRef<
	HTMLDivElement,
	AgentComposerSettingsEndProps
>(function AgentComposerSettingsEnd({ className, ...props }, ref) {
	return (
		<div
			{...props}
			ref={ref}
			className={clsx(
				"ml-auto flex min-w-0 items-center gap-2 max-[560px]:shrink-0",
				className,
			)}
		/>
	);
});
