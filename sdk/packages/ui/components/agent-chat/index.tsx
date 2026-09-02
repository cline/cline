"use client";

import {
	type ButtonHTMLAttributes,
	createContext,
	forwardRef,
	type HTMLAttributes,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type Ref,
	type RefCallback,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { IconButton } from "../button.js";
import {
	DisclosureContent,
	type DisclosureContentPresentation,
	type DisclosureState,
	useDisclosureState,
} from "./disclosure.js";

const STICK_TO_BOTTOM_THRESHOLD_PX = 24;
const SCROLL_BUTTON_THRESHOLD_PX = 120;

function classNames(...values: Array<string | undefined | false>): string {
	return values.filter(Boolean).join(" ");
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
	if (typeof ref === "function") {
		ref(value);
		return;
	}
	if (ref) {
		ref.current = value;
	}
}

export type ConversationContextValue = {
	setContent: (element: HTMLDivElement | null) => void;
	setViewport: (element: HTMLDivElement | null) => void;
	showScrollButton: boolean;
	scrollToBottom: (behavior?: ScrollBehavior) => void;
};

const ConversationContext = createContext<ConversationContextValue | null>(
	null,
);

/**
 * Access the surrounding Conversation's scroll controls — e.g. to force a
 * scroll to the latest message when the user submits, regardless of where
 * they had scrolled. Must be called under a `Conversation`.
 */
export function useConversation(): ConversationContextValue {
	const context = useContext(ConversationContext);
	if (!context) {
		throw new Error(
			"Conversation components must be rendered inside Conversation",
		);
	}
	return context;
}

export type ConversationProps = HTMLAttributes<HTMLDivElement>;

export const Conversation = forwardRef<HTMLDivElement, ConversationProps>(
	({ children, className, ...props }, ref) => {
		const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
		const [content, setContent] = useState<HTMLDivElement | null>(null);
		const [showScrollButton, setShowScrollButton] = useState(false);
		const shouldStickToBottom = useRef(true);
		const isProgrammaticScroll = useRef(false);
		const lastProgrammaticScrollTop = useRef(0);
		const lastObservedScrollTop = useRef(0);
		const programmaticScrollTimer = useRef<number | null>(null);

		const clearProgrammaticScroll = useCallback(() => {
			if (programmaticScrollTimer.current !== null) {
				window.clearTimeout(programmaticScrollTimer.current);
				programmaticScrollTimer.current = null;
			}
		}, []);

		const updateScrollPosition = useCallback(() => {
			if (!viewport) return;
			const distance =
				viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
			const scrolledUp = viewport.scrollTop < lastObservedScrollTop.current - 1;
			lastObservedScrollTop.current = viewport.scrollTop;
			if (isProgrammaticScroll.current) {
				if (viewport.scrollTop + 1 < lastProgrammaticScrollTop.current) {
					isProgrammaticScroll.current = false;
					clearProgrammaticScroll();
				} else {
					lastProgrammaticScrollTop.current = viewport.scrollTop;
					shouldStickToBottom.current = true;
					setShowScrollButton(false);
					if (distance <= STICK_TO_BOTTOM_THRESHOLD_PX) {
						isProgrammaticScroll.current = false;
						clearProgrammaticScroll();
					}
					return;
				}
			}
			// Sticking is an intent, not a position: content growing under a
			// pinned viewport briefly widens `distance` before the resize
			// observer re-pins, and a scroll event landing in that window must
			// not read as the user leaving the bottom. Only an actual upward
			// scroll releases the pin; reaching the bottom always restores it.
			if (distance <= STICK_TO_BOTTOM_THRESHOLD_PX) {
				shouldStickToBottom.current = true;
			} else if (scrolledUp) {
				shouldStickToBottom.current = false;
			}
			setShowScrollButton(distance > SCROLL_BUTTON_THRESHOLD_PX);
		}, [clearProgrammaticScroll, viewport]);

		const scrollToBottom = useCallback(
			(behavior: ScrollBehavior = "smooth") => {
				if (!viewport) return;
				clearProgrammaticScroll();
				const prefersReducedMotion =
					behavior === "smooth" &&
					typeof window.matchMedia === "function" &&
					window.matchMedia("(prefers-reduced-motion: reduce)").matches;
				const effectiveBehavior = prefersReducedMotion ? "auto" : behavior;
				const isSmooth = effectiveBehavior === "smooth";
				isProgrammaticScroll.current = isSmooth;
				lastProgrammaticScrollTop.current = viewport.scrollTop;
				shouldStickToBottom.current = true;
				viewport.scrollTo({
					top: viewport.scrollHeight,
					behavior: effectiveBehavior,
				});
				lastObservedScrollTop.current = viewport.scrollTop;
				setShowScrollButton(false);
				if (!isSmooth) return;
				programmaticScrollTimer.current = window.setTimeout(() => {
					isProgrammaticScroll.current = false;
					programmaticScrollTimer.current = null;
					updateScrollPosition();
				}, 1500);
			},
			[clearProgrammaticScroll, updateScrollPosition, viewport],
		);

		useEffect(() => {
			if (!viewport) return;
			updateScrollPosition();
			viewport.addEventListener("scroll", updateScrollPosition);
			const cancelProgrammaticScroll = () => {
				if (!isProgrammaticScroll.current) return;
				isProgrammaticScroll.current = false;
				clearProgrammaticScroll();
				updateScrollPosition();
			};
			viewport.addEventListener("touchstart", cancelProgrammaticScroll, {
				passive: true,
			});
			viewport.addEventListener("pointerdown", cancelProgrammaticScroll, {
				passive: true,
			});
			const cancelProgrammaticScrollOnKeydown = (event: KeyboardEvent) => {
				if (
					[
						"ArrowDown",
						"ArrowUp",
						"End",
						"Home",
						"PageDown",
						"PageUp",
						" ",
					].includes(event.key)
				) {
					cancelProgrammaticScroll();
				}
			};
			viewport.addEventListener("keydown", cancelProgrammaticScrollOnKeydown);
			viewport.addEventListener("wheel", cancelProgrammaticScroll, {
				passive: true,
			});
			return () => {
				viewport.removeEventListener("scroll", updateScrollPosition);
				viewport.removeEventListener("touchstart", cancelProgrammaticScroll);
				viewport.removeEventListener("pointerdown", cancelProgrammaticScroll);
				viewport.removeEventListener(
					"keydown",
					cancelProgrammaticScrollOnKeydown,
				);
				viewport.removeEventListener("wheel", cancelProgrammaticScroll);
			};
		}, [clearProgrammaticScroll, updateScrollPosition, viewport]);

		useEffect(() => () => clearProgrammaticScroll(), [clearProgrammaticScroll]);

		useLayoutEffect(() => {
			if (!viewport || !content) return;
			scrollToBottom("auto");
		}, [content, scrollToBottom, viewport]);

		useEffect(() => {
			if (!content || !viewport || typeof ResizeObserver === "undefined")
				return;
			const observer = new ResizeObserver(() => {
				if (shouldStickToBottom.current) {
					scrollToBottom("auto");
				} else {
					updateScrollPosition();
				}
			});
			observer.observe(content);
			observer.observe(viewport);
			return () => observer.disconnect();
		}, [content, scrollToBottom, updateScrollPosition, viewport]);

		const value = useMemo<ConversationContextValue>(
			() => ({
				scrollToBottom,
				setContent,
				setViewport,
				showScrollButton,
			}),
			[scrollToBottom, showScrollButton],
		);

		return (
			<ConversationContext.Provider value={value}>
				<div
					className={classNames("cline-chat-conversation", className)}
					ref={ref}
					{...props}
				>
					{children}
				</div>
			</ConversationContext.Provider>
		);
	},
);

Conversation.displayName = "Conversation";

export type ConversationViewportProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"role"
>;

export const ConversationViewport = forwardRef<
	HTMLDivElement,
	ConversationViewportProps
>(
	(
		{
			"aria-label": ariaLabel = "Agent conversation",
			"aria-live": ariaLive = "polite",
			className,
			tabIndex = 0,
			...props
		},
		forwardedRef,
	) => {
		const { setViewport } = useConversation();
		const ref = useCallback<RefCallback<HTMLDivElement>>(
			(element) => {
				setViewport(element);
				assignRef(forwardedRef, element);
			},
			[forwardedRef, setViewport],
		);

		return (
			<div
				{...props}
				aria-label={ariaLabel}
				aria-live={ariaLive}
				className={classNames("cline-chat-conversation-viewport", className)}
				ref={ref}
				role="log"
				tabIndex={tabIndex}
			/>
		);
	},
);

ConversationViewport.displayName = "ConversationViewport";

export type ConversationContentProps = HTMLAttributes<HTMLDivElement>;

export const ConversationContent = forwardRef<
	HTMLDivElement,
	ConversationContentProps
>(({ className, ...props }, forwardedRef) => {
	const { setContent } = useConversation();
	const ref = useCallback<RefCallback<HTMLDivElement>>(
		(element) => {
			setContent(element);
			assignRef(forwardedRef, element);
		},
		[forwardedRef, setContent],
	);

	return (
		<div
			className={classNames("cline-chat-conversation-content", className)}
			ref={ref}
			{...props}
		/>
	);
});

ConversationContent.displayName = "ConversationContent";

export type ConversationEmptyStateProps = HTMLAttributes<HTMLDivElement> & {
	title?: string;
	description?: string;
	icon?: ReactNode;
};

export const ConversationEmptyState = ({
	children,
	className,
	description = "Start a conversation to see messages here.",
	icon,
	title = "No messages yet",
	...props
}: ConversationEmptyStateProps) => (
	<div className={classNames("cline-chat-empty-state", className)} {...props}>
		{children ?? (
			<>
				{icon ? (
					<div className="cline-chat-empty-state-icon">{icon}</div>
				) : null}
				<div>
					<h3>{title}</h3>
					{description ? <p>{description}</p> : null}
				</div>
			</>
		)}
	</div>
);

export type ConversationScrollButtonProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"type"
>;

export const ConversationScrollButton = ({
	"aria-label": ariaLabel = "Scroll to latest message",
	children,
	className,
	onClick,
	...props
}: ConversationScrollButtonProps) => {
	const { scrollToBottom, showScrollButton } = useConversation();
	if (!showScrollButton) return null;

	return (
		<button
			{...props}
			aria-label={ariaLabel}
			className={classNames("cline-chat-scroll-button", className)}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) scrollToBottom();
			}}
			type="button"
		>
			{children ?? <ChevronDownIcon />}
		</button>
	);
};

export type AgentMessageRole =
	| "user"
	| "assistant"
	| "system"
	| "status"
	| "error";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
	from: AgentMessageRole;
};

export const Message = ({ className, from, ...props }: MessageProps) => (
	<div
		{...props}
		className={classNames("cline-chat-message", className)}
		data-role={from}
	/>
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
	className,
	...props
}: MessageContentProps) => (
	<div
		className={classNames("cline-chat-message-content", className)}
		{...props}
	/>
);

export type MessageActionsProps = HTMLAttributes<HTMLDivElement> & {
	side?: "start" | "end";
	visible?: boolean;
};

export const MessageActions = ({
	className,
	side,
	visible = false,
	...props
}: MessageActionsProps) => (
	<div
		{...props}
		className={classNames("cline-chat-message-actions", className)}
		data-side={side}
		data-visible={visible || undefined}
	/>
);

export type MessageActionProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"type"
> & {
	label: string;
};

export const MessageAction = ({
	"aria-label": ariaLabel,
	className,
	label,
	...props
}: MessageActionProps) => (
	<IconButton
		{...props}
		aria-label={ariaLabel ?? label}
		className={classNames("cline-chat-message-action", className)}
		variant="ghost"
		tone="neutral"
		size="xs"
	/>
);

type ReasoningContextValue = DisclosureState & {
	isStreaming: boolean;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

function useReasoning(): ReasoningContextValue {
	const context = useContext(ReasoningContext);
	if (!context) {
		throw new Error("Reasoning components must be rendered inside Reasoning");
	}
	return context;
}

export type ReasoningProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"onChange"
> & {
	isStreaming?: boolean;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
};

export const Reasoning = ({
	className,
	defaultOpen = false,
	isStreaming = false,
	onOpenChange,
	open,
	...props
}: ReasoningProps) => {
	const { isOpen, panelId, setIsOpen } = useDisclosureState({
		defaultOpen,
		onOpenChange,
		open,
	});
	const value = useMemo(
		() => ({ isOpen, isStreaming, panelId, setIsOpen }),
		[isOpen, isStreaming, panelId, setIsOpen],
	);

	return (
		<ReasoningContext.Provider value={value}>
			<div
				{...props}
				className={classNames("cline-chat-reasoning", className)}
				data-streaming={isStreaming || undefined}
			/>
		</ReasoningContext.Provider>
	);
};

export type ReasoningTriggerProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"aria-controls" | "aria-expanded" | "type"
> & {
	completeLabel?: string;
	streamingLabel?: string;
};

export const ReasoningTrigger = ({
	children,
	className,
	completeLabel = "Thinking",
	onClick,
	streamingLabel = "Thinking",
	...props
}: ReasoningTriggerProps) => {
	const { isOpen, isStreaming, panelId, setIsOpen } = useReasoning();
	return (
		<button
			{...props}
			aria-controls={panelId}
			aria-expanded={isOpen}
			className={classNames("cline-chat-reasoning-trigger", className)}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) setIsOpen(!isOpen);
			}}
			type="button"
		>
			{children ?? (
				<>
					<span>{isStreaming ? streamingLabel : completeLabel}</span>
					<ChevronDownIcon className="cline-chat-disclosure-icon" />
				</>
			)}
		</button>
	);
};

export type ReasoningContentProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"hidden" | "id"
> & {
	presentation?: DisclosureContentPresentation;
};

export const ReasoningContent = ({
	presentation,
	...props
}: ReasoningContentProps) => {
	const { isOpen, panelId } = useReasoning();
	return (
		<DisclosureContent
			{...props}
			contentClassName="cline-chat-reasoning-content"
			isOpen={isOpen}
			lazyContent
			panelId={panelId}
			presentation={presentation}
		/>
	);
};

/** "Thinking" while the duration is unknown, "Thought for Ns" once it is. */
export function formatThoughtLabel(durationMilliseconds?: number): string {
	if (durationMilliseconds === undefined) {
		return "Thinking";
	}

	const seconds =
		durationMilliseconds === 0
			? 0
			: Math.max(1, Math.round(durationMilliseconds / 1000));

	return `Thought for ${seconds}s`;
}

export type ThinkingBlockProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"children" | "onChange"
> & {
	durationMilliseconds?: number;
	isStreaming?: boolean;
	redacted?: boolean;
	/** Overrides the derived "Thinking" / "Thought for Ns" label. */
	label?: string;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Rendered reasoning body — typically the product's Markdown output. */
	children?: ReactNode;
};

/**
 * The standard thinking-trace row: brain icon, "Thinking"/"Thought for Ns"
 * label (shimmering while streaming), and the reasoning body under the shared
 * disclosure rail, capped to a scrollable height. Products supply the rendered
 * body as children so they keep their own Markdown policy.
 */
export const ThinkingBlock = ({
	children,
	className,
	defaultOpen,
	durationMilliseconds,
	isStreaming = false,
	label,
	onOpenChange,
	open,
	redacted = false,
	...props
}: ThinkingBlockProps) => {
	const resolvedLabel =
		label ??
		(isStreaming ? "Thinking" : formatThoughtLabel(durationMilliseconds));
	return (
		<Reasoning
			{...props}
			className={className}
			defaultOpen={defaultOpen}
			isStreaming={isStreaming}
			onOpenChange={onOpenChange}
			open={open}
		>
			<ReasoningTrigger aria-label={resolvedLabel}>
				<BrainIcon className="cline-chat-thinking-icon" />
				<span
					className={isStreaming ? "cline-chat-streaming-title" : undefined}
				>
					{resolvedLabel}
				</span>
			</ReasoningTrigger>
			<ReasoningContent
				className="cline-chat-thinking-content"
				presentation="rail"
			>
				{children ?? (redacted ? "[redacted]" : null)}
			</ReasoningContent>
		</Reasoning>
	);
};

export type ToolActivityStatus = "pending" | "running" | "success" | "error";

type ToolActivityContextValue = DisclosureState & {
	expandable: boolean;
};

const ToolActivityContext = createContext<ToolActivityContextValue | null>(
	null,
);

function useToolActivity(): ToolActivityContextValue {
	const context = useContext(ToolActivityContext);
	if (!context) {
		throw new Error(
			"ToolActivity components must be rendered inside ToolActivity",
		);
	}
	return context;
}

export type ToolActivityProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"onChange"
> & {
	expandable?: boolean;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
};

export const ToolActivity = ({
	className,
	defaultOpen = false,
	expandable = true,
	onOpenChange,
	open,
	...props
}: ToolActivityProps) => {
	const { isOpen, panelId, setIsOpen } = useDisclosureState({
		defaultOpen,
		enabled: expandable,
		onOpenChange,
		open,
	});
	const value = useMemo(
		() => ({ expandable, isOpen, panelId, setIsOpen }),
		[expandable, isOpen, panelId, setIsOpen],
	);

	return (
		<ToolActivityContext.Provider value={value}>
			<div
				{...props}
				className={classNames("cline-chat-tool", className)}
				data-expandable={expandable || undefined}
			/>
		</ToolActivityContext.Provider>
	);
};

export type ToolActivityTriggerProps = Omit<
	HTMLAttributes<HTMLElement>,
	"aria-controls" | "aria-expanded"
> & {
	icon?: ReactNode;
	label: ReactNode;
	status?: ToolActivityStatus;
	additions?: number;
	deletions?: number;
	disabled?: boolean;
	/** Show the chevron that hints the row expands. The row stays clickable when hidden. */
	showDisclosureIcon?: boolean;
};

export const ToolActivityTrigger = ({
	additions,
	children,
	className,
	deletions,
	disabled = false,
	icon,
	label,
	onClick,
	showDisclosureIcon = true,
	status = "success",
	...props
}: ToolActivityTriggerProps) => {
	const { expandable, isOpen, panelId, setIsOpen } = useToolActivity();
	// While the tool is still working, the spinner takes the icon's slot so the
	// row reads as one glyph + label instead of sprouting chrome on the right.
	const inFlight = status === "running" || status === "pending";
	const content = children ?? (
		<>
			{inFlight ? (
				<output aria-label={status} className="cline-chat-tool-progress" />
			) : icon ? (
				<span className="cline-chat-tool-icon">{icon}</span>
			) : null}
			<span className="cline-chat-tool-label">{label}</span>
			{additions !== undefined || deletions !== undefined ? (
				<span className="cline-chat-tool-diff">
					{additions !== undefined ? (
						<span data-diff="additions">+{additions}</span>
					) : null}{" "}
					{deletions !== undefined ? (
						<span data-diff="deletions">-{deletions}</span>
					) : null}
				</span>
			) : null}
			{expandable && showDisclosureIcon ? (
				<ChevronDownIcon className="cline-chat-disclosure-icon" />
			) : null}
		</>
	);
	const handleClick = (event: ReactMouseEvent<HTMLElement>) => {
		onClick?.(event);
		if (expandable && !event.defaultPrevented) setIsOpen(!isOpen);
	};
	const triggerClassName = classNames("cline-chat-tool-trigger", className);

	if (expandable) {
		return (
			<button
				{...(props as ButtonHTMLAttributes<HTMLButtonElement>)}
				aria-controls={panelId}
				aria-expanded={isOpen}
				className={triggerClassName}
				data-status={status}
				disabled={disabled}
				onClick={handleClick}
				type="button"
			>
				{content}
			</button>
		);
	}

	return (
		<div
			{...(props as HTMLAttributes<HTMLDivElement>)}
			className={triggerClassName}
			data-status={status}
		>
			{content}
		</div>
	);
};

export type ToolActivityContentProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"hidden" | "id"
> & {
	presentation?: DisclosureContentPresentation;
};

export const ToolActivityContent = ({
	presentation,
	...props
}: ToolActivityContentProps) => {
	const { expandable, isOpen, panelId } = useToolActivity();
	if (!expandable) return null;
	return (
		<DisclosureContent
			{...props}
			contentClassName="cline-chat-tool-content"
			isOpen={isOpen}
			lazyContent
			panelId={panelId}
			presentation={presentation}
		/>
	);
};

const WorkActivityContext = createContext<DisclosureState | null>(null);

function useWorkActivity(): DisclosureState {
	const context = useContext(WorkActivityContext);
	if (!context) {
		throw new Error(
			"WorkActivity components must be rendered inside WorkActivity",
		);
	}
	return context;
}

export type WorkActivityLabelOptions = {
	durationMilliseconds?: number;
	toolCallCount?: number;
};

/** Compact "3s" / "4m 12s" / "1h 3m" duration for work summary rows. */
export function formatWorkDuration(durationMilliseconds: number): string {
	const totalSeconds = Math.max(1, Math.round(durationMilliseconds / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
	if (minutes > 0)
		return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
	return `${seconds}s`;
}

/** "Worked for 4m 12s and made 14 tool calls" with graceful fallbacks when
 * either number is unknown. */
export function formatWorkActivityLabel({
	durationMilliseconds,
	toolCallCount,
}: WorkActivityLabelOptions): string {
	const worked =
		durationMilliseconds !== undefined &&
		Number.isFinite(durationMilliseconds) &&
		durationMilliseconds >= 0
			? `Worked for ${formatWorkDuration(durationMilliseconds)}`
			: undefined;
	const calls = toolCallCount
		? `${toolCallCount} ${toolCallCount === 1 ? "tool call" : "tool calls"}`
		: undefined;
	if (worked && calls) return `${worked} and made ${calls}`;
	if (worked) return worked;
	if (calls) return `Made ${calls}`;
	return "Worked";
}

export type WorkActivityProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"onChange"
> & {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
};

/**
 * Collapsed summary of a finished agent run: the tool calls, thinking traces,
 * and working narration that produced an answer fold into a single "Worked
 * for 4m 12s and made 14 tool calls" row that expands back into the full rows.
 */
export const WorkActivity = ({
	className,
	defaultOpen = false,
	onOpenChange,
	open,
	...props
}: WorkActivityProps) => {
	const value = useDisclosureState({ defaultOpen, onOpenChange, open });

	return (
		<WorkActivityContext.Provider value={value}>
			<div {...props} className={classNames("cline-chat-work", className)} />
		</WorkActivityContext.Provider>
	);
};

export type WorkActivityTriggerProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"aria-controls" | "aria-expanded" | "type"
> &
	WorkActivityLabelOptions;

export const WorkActivityTrigger = ({
	children,
	className,
	durationMilliseconds,
	onClick,
	toolCallCount,
	...props
}: WorkActivityTriggerProps) => {
	const { isOpen, panelId, setIsOpen } = useWorkActivity();
	return (
		<button
			{...props}
			aria-controls={panelId}
			aria-expanded={isOpen}
			className={classNames("cline-chat-work-trigger", className)}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) setIsOpen(!isOpen);
			}}
			type="button"
		>
			{children ?? (
				<>
					<span className="cline-chat-tool-label">
						{formatWorkActivityLabel({ durationMilliseconds, toolCallCount })}
					</span>
					<ChevronDownIcon className="cline-chat-disclosure-icon" />
				</>
			)}
		</button>
	);
};

export type WorkActivityContentProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"hidden" | "id"
> & {
	presentation?: DisclosureContentPresentation;
};

/**
 * Expanded work re-shows the run's normal chat rows at transcript level — no
 * rail or extra indent, since the rows inside (tool disclosures, thinking
 * traces) already carry their own nesting when expanded.
 */
export const WorkActivityContent = ({
	presentation,
	...props
}: WorkActivityContentProps) => {
	const { isOpen, panelId } = useWorkActivity();
	return (
		<DisclosureContent
			{...props}
			contentClassName="cline-chat-work-content"
			isOpen={isOpen}
			lazyContent
			panelId={panelId}
			presentation={presentation}
		/>
	);
};

export type ToolActivityDetailsProps = HTMLAttributes<HTMLDivElement>;

export const ToolActivityDetails = ({
	className,
	...props
}: ToolActivityDetailsProps) => (
	<div
		className={classNames("cline-chat-tool-details", className)}
		{...props}
	/>
);

export type ToolActivityCodeProps = HTMLAttributes<HTMLPreElement>;

export const ToolActivityCode = ({
	className,
	...props
}: ToolActivityCodeProps) => (
	<pre className={classNames("cline-chat-tool-code", className)} {...props} />
);

function BrainIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			height="16"
			viewBox="0 0 24 24"
			width="16"
		>
			<g
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="2"
			>
				<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
				<path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
				<path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
				<path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
				<path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
				<path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
				<path d="M19.938 10.5a4 4 0 0 1 .585.396" />
				<path d="M6 18a4 4 0 0 1-1.967-.516" />
				<path d="M19.967 17.484A4 4 0 0 1 18 18" />
			</g>
		</svg>
	);
}

function ChevronDownIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			height="16"
			viewBox="0 0 24 24"
			width="16"
		>
			<path
				d="m6 9 6 6 6-6"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="2"
			/>
		</svg>
	);
}
