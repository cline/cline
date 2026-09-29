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

const PINNED_THRESHOLD_PX = 24;
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

export type ConversationScrollState = {
	/** Follow new content to the bottom. When true, `scrollTop` is ignored. */
	pinned: boolean;
	scrollTop: number;
};

export type ConversationContextValue = {
	setContent: (element: HTMLDivElement | null) => void;
	setViewport: (element: HTMLDivElement | null) => void;
	showScrollButton: boolean;
	isPinned: boolean;
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

export type ConversationProps = HTMLAttributes<HTMLDivElement> & {
	/** Applied on first mount only; later changes are ignored. */
	initialScrollState?: ConversationScrollState;
	/** Fires for the reader's own scrolls, never for programmatic ones. */
	onScrollStateChange?: (state: ConversationScrollState) => void;
};

function distanceFromBottom(viewport: HTMLDivElement): number {
	return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

type ReadingAnchor = { element: Element; offsetTop: number };

/**
 * The element the reader is looking at. Its position relative to the viewport
 * is what must not move when content elsewhere changes height.
 *
 * Consumers nest rows inside layout wrappers and add siblings (banners,
 * notices), so the DOM shape cannot be assumed. Descend from `content`
 * through whichever child crosses the viewport's top edge; the deepest such
 * element is the row being read. If none crosses it (the reader is in a gap
 * between rows), the first child starting below the edge is the anchor.
 */
function findReadingAnchor(
	viewport: HTMLDivElement,
	content: HTMLDivElement,
): ReadingAnchor | null {
	const viewportTop = viewport.getBoundingClientRect().top;
	const anchorFor = (element: Element): ReadingAnchor => ({
		element,
		offsetTop: element.getBoundingClientRect().top - viewportTop,
	});

	let current: Element = content;
	for (;;) {
		let crossing: Element | null = null;
		let firstBelow: Element | null = null;
		for (const child of current.children) {
			const rect = child.getBoundingClientRect();
			if (rect.bottom <= viewportTop) continue;
			if (rect.top < viewportTop) {
				crossing = child;
			} else {
				firstBelow = child;
			}
			break;
		}
		if (crossing) {
			current = crossing;
			continue;
		}
		if (firstBelow) return anchorFor(firstBelow);
		return current === content ? null : anchorFor(current);
	}
}

/**
 * The reader owns their scroll position. Only their own input un-pins the
 * view from the bottom, and only reaching the bottom (by scrolling, the
 * scroll button, or `scrollToBottom()`) re-pins it. Programmatic scrolls
 * are tracked via `ourScrollTarget` so their scroll events are never
 * mistaken for the reader's.
 */
export const Conversation = forwardRef<HTMLDivElement, ConversationProps>(
	(
		{ children, className, initialScrollState, onScrollStateChange, ...props },
		ref,
	) => {
		const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
		const [content, setContent] = useState<HTMLDivElement | null>(null);
		const [isPinned, setIsPinned] = useState(
			initialScrollState?.pinned ?? true,
		);
		const [showScrollButton, setShowScrollButton] = useState(false);
		const pinnedRef = useRef(isPinned);
		const ourScrollTarget = useRef<number | null>(null);
		// A remembered position the transcript is not yet tall enough to reach.
		// Held until the content grows enough, then applied once.
		const pendingRestore = useRef<number | null>(
			initialScrollState && !initialScrollState.pinned
				? initialScrollState.scrollTop
				: null,
		);
		const anchor = useRef<ReadingAnchor | null>(null);
		const onScrollStateChangeRef = useRef(onScrollStateChange);
		onScrollStateChangeRef.current = onScrollStateChange;

		const setPinned = useCallback((pinned: boolean) => {
			pinnedRef.current = pinned;
			setIsPinned(pinned);
			if (pinned) setShowScrollButton(false);
		}, []);

		const writeScrollTop = useCallback(
			(target: HTMLDivElement, top: number, behavior: ScrollBehavior) => {
				const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
				const clampedTop = Math.min(Math.max(0, top), maxTop);
				ourScrollTarget.current =
					clampedTop !== target.scrollTop ? clampedTop : null;
				target.scrollTo({ top: clampedTop, behavior });
			},
			[],
		);

		const scrollToBottom = useCallback(
			(behavior: ScrollBehavior = "smooth") => {
				if (!viewport) return;
				const prefersReducedMotion =
					typeof window.matchMedia === "function" &&
					window.matchMedia("(prefers-reduced-motion: reduce)").matches;
				pendingRestore.current = null;
				setPinned(true);
				writeScrollTop(
					viewport,
					viewport.scrollHeight,
					prefersReducedMotion ? "auto" : behavior,
				);
				onScrollStateChangeRef.current?.({
					pinned: true,
					scrollTop: viewport.scrollTop,
				});
			},
			[setPinned, viewport, writeScrollTop],
		);

		useEffect(() => {
			if (!viewport) return;

			const handleScroll = () => {
				if (ourScrollTarget.current !== null) {
					const arrived =
						Math.abs(viewport.scrollTop - ourScrollTarget.current) <= 1;
					// A smooth scroll emits many events before arriving; all of them
					// are ours unless the reader un-pinned mid-flight.
					if (arrived || pinnedRef.current) {
						if (arrived) ourScrollTarget.current = null;
						return;
					}
					ourScrollTarget.current = null;
				}
				pendingRestore.current = null;
				const distance = distanceFromBottom(viewport);
				const pinned = distance <= PINNED_THRESHOLD_PX;
				setPinned(pinned);
				setShowScrollButton(distance > SCROLL_BUTTON_THRESHOLD_PX);
				anchor.current =
					!pinned && content ? findReadingAnchor(viewport, content) : null;
				onScrollStateChangeRef.current?.({
					pinned,
					scrollTop: viewport.scrollTop,
				});
			};

			// Un-pin on input, not on the resulting scroll event: the event is
			// async, and streamed content landing before it would snap the
			// reader back to the bottom.
			const handleWheel = (event: WheelEvent) => {
				if (event.deltaY < 0) setPinned(false);
			};
			// Arrow keys inside a focused child (a button, a code block) are
			// that control's business, not a scroll.
			const handleKeyDown = (event: KeyboardEvent) => {
				if (event.target !== viewport) return;
				if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
					setPinned(false);
				}
			};

			viewport.addEventListener("scroll", handleScroll, { passive: true });
			viewport.addEventListener("wheel", handleWheel, { passive: true });
			viewport.addEventListener("keydown", handleKeyDown);
			return () => {
				viewport.removeEventListener("scroll", handleScroll);
				viewport.removeEventListener("wheel", handleWheel);
				viewport.removeEventListener("keydown", handleKeyDown);
			};
		}, [content, setPinned, viewport]);

		// The transcript may still be loading when a remembered position is
		// applied, so the target is kept until the content can reach it.
		const restoreIfReachable = useCallback(() => {
			if (!viewport || !content || pendingRestore.current === null) return;
			const maxTop = viewport.scrollHeight - viewport.clientHeight;
			if (maxTop < pendingRestore.current) return;
			writeScrollTop(viewport, pendingRestore.current, "auto");
			pendingRestore.current = null;
			anchor.current = findReadingAnchor(viewport, content);
			setShowScrollButton(
				distanceFromBottom(viewport) > SCROLL_BUTTON_THRESHOLD_PX,
			);
		}, [content, viewport, writeScrollTop]);

		useLayoutEffect(() => {
			if (!viewport || !content) return;
			if (pinnedRef.current) {
				scrollToBottom("auto");
			} else {
				restoreIfReachable();
			}
		}, [content, restoreIfReachable, scrollToBottom, viewport]);

		// WebKit has no CSS scroll anchoring. While un-pinned, keep the row the
		// reader is looking at where it is: growth below them must not move it,
		// and growth or shrinkage above them must be absorbed by scrollTop.
		useEffect(() => {
			if (!content || !viewport || typeof ResizeObserver === "undefined")
				return;
			const observer = new ResizeObserver(() => {
				if (pinnedRef.current) {
					scrollToBottom("auto");
					return;
				}
				if (pendingRestore.current !== null) {
					restoreIfReachable();
					return;
				}
				const current = anchor.current;
				if (current?.element.isConnected) {
					const viewportTop = viewport.getBoundingClientRect().top;
					const drift =
						current.element.getBoundingClientRect().top -
						viewportTop -
						current.offsetTop;
					if (Math.abs(drift) > 1) {
						writeScrollTop(viewport, viewport.scrollTop + drift, "auto");
					}
				} else {
					anchor.current = findReadingAnchor(viewport, content);
				}
				setShowScrollButton(
					distanceFromBottom(viewport) > SCROLL_BUTTON_THRESHOLD_PX,
				);
			});
			observer.observe(content);
			observer.observe(viewport);
			return () => observer.disconnect();
		}, [content, restoreIfReachable, scrollToBottom, viewport, writeScrollTop]);

		const value = useMemo<ConversationContextValue>(
			() => ({
				isPinned,
				scrollToBottom,
				setContent,
				setViewport,
				showScrollButton,
			}),
			[isPinned, scrollToBottom, showScrollButton],
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
