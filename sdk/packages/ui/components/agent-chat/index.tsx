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
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

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

type ConversationContextValue = {
	setContent: (element: HTMLDivElement | null) => void;
	setViewport: (element: HTMLDivElement | null) => void;
	showScrollButton: boolean;
	scrollToBottom: (behavior?: ScrollBehavior) => void;
};

const ConversationContext = createContext<ConversationContextValue | null>(
	null,
);

function useConversation(): ConversationContextValue {
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
			shouldStickToBottom.current = distance <= STICK_TO_BOTTOM_THRESHOLD_PX;
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
	visible?: boolean;
};

export const MessageActions = ({
	className,
	visible = false,
	...props
}: MessageActionsProps) => (
	<div
		{...props}
		className={classNames("cline-chat-message-actions", className)}
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
	<button
		{...props}
		aria-label={ariaLabel ?? label}
		className={classNames("cline-chat-message-action", className)}
		type="button"
	/>
);

type DisclosureState = {
	isOpen: boolean;
	panelId: string;
	setIsOpen: (open: boolean) => void;
};

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
	const [internalOpen, setInternalOpen] = useState(defaultOpen);
	const panelId = useId();
	const isOpen = open ?? internalOpen;
	const setIsOpen = useCallback(
		(nextOpen: boolean) => {
			if (open === undefined) setInternalOpen(nextOpen);
			onOpenChange?.(nextOpen);
		},
		[onOpenChange, open],
	);
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
	completeLabel = "Thought process",
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
					<BrainIcon />
					<span>{isStreaming ? streamingLabel : completeLabel}</span>
					<span aria-live="polite" className="cline-chat-reasoning-status">
						{isStreaming ? "In progress" : "Complete"}
					</span>
					<ChevronDownIcon className="cline-chat-disclosure-icon" />
				</>
			)}
		</button>
	);
};

export type ReasoningContentProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"hidden" | "id"
>;

export const ReasoningContent = ({
	className,
	...props
}: ReasoningContentProps) => {
	const { isOpen, panelId } = useReasoning();
	if (!isOpen) return null;
	return (
		<div
			{...props}
			className={classNames("cline-chat-reasoning-content", className)}
			id={panelId}
		/>
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
	const [internalOpen, setInternalOpen] = useState(defaultOpen);
	const panelId = useId();
	const isOpen = expandable && (open ?? internalOpen);
	const setIsOpen = useCallback(
		(nextOpen: boolean) => {
			if (!expandable) return;
			if (open === undefined) setInternalOpen(nextOpen);
			onOpenChange?.(nextOpen);
		},
		[expandable, onOpenChange, open],
	);
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
	status = "success",
	...props
}: ToolActivityTriggerProps) => {
	const { expandable, isOpen, panelId, setIsOpen } = useToolActivity();
	const content = children ?? (
		<>
			{icon ? <span className="cline-chat-tool-icon">{icon}</span> : null}
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
			{status === "running" || status === "pending" ? (
				<output aria-label={status} className="cline-chat-tool-progress" />
			) : null}
			{expandable ? (
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
>;

export const ToolActivityContent = ({
	className,
	...props
}: ToolActivityContentProps) => {
	const { expandable, isOpen, panelId } = useToolActivity();
	if (!expandable || !isOpen) return null;
	return (
		<div
			{...props}
			className={classNames("cline-chat-tool-content", className)}
			id={panelId}
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

function BrainIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="16"
			viewBox="0 0 24 24"
			width="16"
		>
			<path
				d="M9.5 4.5A3 3 0 0 0 4 6a3 3 0 0 0 .5 5.9A3.5 3.5 0 0 0 8 17h1.5m5-12.5A3 3 0 0 1 20 6a3 3 0 0 1-.5 5.9A3.5 3.5 0 0 1 16 17h-1.5M9.5 4.5V20m5-15.5V20M9.5 9H7m7.5 3H17m-7.5 4H7m7.5 1h2"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.75"
			/>
		</svg>
	);
}
