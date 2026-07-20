"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, } from "react";
const STICK_TO_BOTTOM_THRESHOLD_PX = 24;
const SCROLL_BUTTON_THRESHOLD_PX = 120;
function classNames(...values) {
    return values.filter(Boolean).join(" ");
}
function assignRef(ref, value) {
    if (typeof ref === "function") {
        ref(value);
        return;
    }
    if (ref) {
        ref.current = value;
    }
}
const ConversationContext = createContext(null);
function useConversation() {
    const context = useContext(ConversationContext);
    if (!context) {
        throw new Error("Conversation components must be rendered inside Conversation");
    }
    return context;
}
export const Conversation = forwardRef(({ children, className, ...props }, ref) => {
    const [viewport, setViewport] = useState(null);
    const [content, setContent] = useState(null);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const shouldStickToBottom = useRef(true);
    const isProgrammaticScroll = useRef(false);
    const lastProgrammaticScrollTop = useRef(0);
    const programmaticScrollTimer = useRef(null);
    const clearProgrammaticScroll = useCallback(() => {
        if (programmaticScrollTimer.current !== null) {
            window.clearTimeout(programmaticScrollTimer.current);
            programmaticScrollTimer.current = null;
        }
    }, []);
    const updateScrollPosition = useCallback(() => {
        if (!viewport)
            return;
        const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        if (isProgrammaticScroll.current) {
            if (viewport.scrollTop + 1 < lastProgrammaticScrollTop.current) {
                isProgrammaticScroll.current = false;
                clearProgrammaticScroll();
            }
            else {
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
    const scrollToBottom = useCallback((behavior = "smooth") => {
        if (!viewport)
            return;
        clearProgrammaticScroll();
        const prefersReducedMotion = behavior === "smooth" &&
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
        if (!isSmooth)
            return;
        programmaticScrollTimer.current = window.setTimeout(() => {
            isProgrammaticScroll.current = false;
            programmaticScrollTimer.current = null;
            updateScrollPosition();
        }, 1500);
    }, [clearProgrammaticScroll, updateScrollPosition, viewport]);
    useEffect(() => {
        if (!viewport)
            return;
        updateScrollPosition();
        viewport.addEventListener("scroll", updateScrollPosition);
        const cancelProgrammaticScroll = () => {
            if (!isProgrammaticScroll.current)
                return;
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
        const cancelProgrammaticScrollOnKeydown = (event) => {
            if ([
                "ArrowDown",
                "ArrowUp",
                "End",
                "Home",
                "PageDown",
                "PageUp",
                " ",
            ].includes(event.key)) {
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
            viewport.removeEventListener("keydown", cancelProgrammaticScrollOnKeydown);
            viewport.removeEventListener("wheel", cancelProgrammaticScroll);
        };
    }, [clearProgrammaticScroll, updateScrollPosition, viewport]);
    useEffect(() => () => clearProgrammaticScroll(), [clearProgrammaticScroll]);
    useLayoutEffect(() => {
        if (!viewport || !content)
            return;
        scrollToBottom("auto");
    }, [content, scrollToBottom, viewport]);
    useEffect(() => {
        if (!content || !viewport || typeof ResizeObserver === "undefined")
            return;
        const observer = new ResizeObserver(() => {
            if (shouldStickToBottom.current) {
                scrollToBottom("auto");
            }
            else {
                updateScrollPosition();
            }
        });
        observer.observe(content);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [content, scrollToBottom, updateScrollPosition, viewport]);
    const value = useMemo(() => ({
        scrollToBottom,
        setContent,
        setViewport,
        showScrollButton,
    }), [scrollToBottom, showScrollButton]);
    return (_jsx(ConversationContext.Provider, { value: value, children: _jsx("div", { className: classNames("cline-chat-conversation", className), ref: ref, ...props, children: children }) }));
});
Conversation.displayName = "Conversation";
export const ConversationViewport = forwardRef(({ "aria-label": ariaLabel = "Agent conversation", "aria-live": ariaLive = "polite", className, tabIndex = 0, ...props }, forwardedRef) => {
    const { setViewport } = useConversation();
    const ref = useCallback((element) => {
        setViewport(element);
        assignRef(forwardedRef, element);
    }, [forwardedRef, setViewport]);
    return (_jsx("div", { ...props, "aria-label": ariaLabel, "aria-live": ariaLive, className: classNames("cline-chat-conversation-viewport", className), ref: ref, role: "log", tabIndex: tabIndex }));
});
ConversationViewport.displayName = "ConversationViewport";
export const ConversationContent = forwardRef(({ className, ...props }, forwardedRef) => {
    const { setContent } = useConversation();
    const ref = useCallback((element) => {
        setContent(element);
        assignRef(forwardedRef, element);
    }, [forwardedRef, setContent]);
    return (_jsx("div", { className: classNames("cline-chat-conversation-content", className), ref: ref, ...props }));
});
ConversationContent.displayName = "ConversationContent";
export const ConversationEmptyState = ({ children, className, description = "Start a conversation to see messages here.", icon, title = "No messages yet", ...props }) => (_jsx("div", { className: classNames("cline-chat-empty-state", className), ...props, children: children ?? (_jsxs(_Fragment, { children: [icon ? (_jsx("div", { className: "cline-chat-empty-state-icon", children: icon })) : null, _jsxs("div", { children: [_jsx("h3", { children: title }), description ? _jsx("p", { children: description }) : null] })] })) }));
export const ConversationScrollButton = ({ "aria-label": ariaLabel = "Scroll to latest message", children, className, onClick, ...props }) => {
    const { scrollToBottom, showScrollButton } = useConversation();
    if (!showScrollButton)
        return null;
    return (_jsx("button", { ...props, "aria-label": ariaLabel, className: classNames("cline-chat-scroll-button", className), onClick: (event) => {
            onClick?.(event);
            if (!event.defaultPrevented)
                scrollToBottom();
        }, type: "button", children: children ?? _jsx(ChevronDownIcon, {}) }));
};
export const Message = ({ className, from, ...props }) => (_jsx("div", { ...props, className: classNames("cline-chat-message", className), "data-role": from }));
export const MessageContent = ({ className, ...props }) => (_jsx("div", { className: classNames("cline-chat-message-content", className), ...props }));
export const MessageActions = ({ className, visible = false, ...props }) => (_jsx("div", { ...props, className: classNames("cline-chat-message-actions", className), "data-visible": visible || undefined }));
export const MessageAction = ({ "aria-label": ariaLabel, className, label, ...props }) => (_jsx("button", { ...props, "aria-label": ariaLabel ?? label, className: classNames("cline-chat-message-action", className), type: "button" }));
const ReasoningContext = createContext(null);
function useReasoning() {
    const context = useContext(ReasoningContext);
    if (!context) {
        throw new Error("Reasoning components must be rendered inside Reasoning");
    }
    return context;
}
export const Reasoning = ({ className, defaultOpen = false, isStreaming = false, onOpenChange, open, ...props }) => {
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const panelId = useId();
    const isOpen = open ?? internalOpen;
    const setIsOpen = useCallback((nextOpen) => {
        if (open === undefined)
            setInternalOpen(nextOpen);
        onOpenChange?.(nextOpen);
    }, [onOpenChange, open]);
    const value = useMemo(() => ({ isOpen, isStreaming, panelId, setIsOpen }), [isOpen, isStreaming, panelId, setIsOpen]);
    return (_jsx(ReasoningContext.Provider, { value: value, children: _jsx("div", { ...props, className: classNames("cline-chat-reasoning", className), "data-streaming": isStreaming || undefined }) }));
};
export const ReasoningTrigger = ({ children, className, completeLabel = "Thought process", onClick, streamingLabel = "Thinking", ...props }) => {
    const { isOpen, isStreaming, panelId, setIsOpen } = useReasoning();
    return (_jsx("button", { ...props, "aria-controls": panelId, "aria-expanded": isOpen, className: classNames("cline-chat-reasoning-trigger", className), onClick: (event) => {
            onClick?.(event);
            if (!event.defaultPrevented)
                setIsOpen(!isOpen);
        }, type: "button", children: children ?? (_jsxs(_Fragment, { children: [_jsx(BrainIcon, {}), _jsx("span", { children: isStreaming ? streamingLabel : completeLabel }), _jsx("span", { "aria-live": "polite", className: "cline-chat-reasoning-status", children: isStreaming ? "In progress" : "Complete" }), _jsx(ChevronDownIcon, { className: "cline-chat-disclosure-icon" })] })) }));
};
export const ReasoningContent = ({ className, ...props }) => {
    const { isOpen, panelId } = useReasoning();
    if (!isOpen)
        return null;
    return (_jsx("div", { ...props, className: classNames("cline-chat-reasoning-content", className), id: panelId }));
};
const ToolActivityContext = createContext(null);
function useToolActivity() {
    const context = useContext(ToolActivityContext);
    if (!context) {
        throw new Error("ToolActivity components must be rendered inside ToolActivity");
    }
    return context;
}
export const ToolActivity = ({ className, defaultOpen = false, expandable = true, onOpenChange, open, ...props }) => {
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const panelId = useId();
    const isOpen = expandable && (open ?? internalOpen);
    const setIsOpen = useCallback((nextOpen) => {
        if (!expandable)
            return;
        if (open === undefined)
            setInternalOpen(nextOpen);
        onOpenChange?.(nextOpen);
    }, [expandable, onOpenChange, open]);
    const value = useMemo(() => ({ expandable, isOpen, panelId, setIsOpen }), [expandable, isOpen, panelId, setIsOpen]);
    return (_jsx(ToolActivityContext.Provider, { value: value, children: _jsx("div", { ...props, className: classNames("cline-chat-tool", className), "data-expandable": expandable || undefined }) }));
};
export const ToolActivityTrigger = ({ additions, children, className, deletions, disabled = false, icon, label, onClick, status = "success", ...props }) => {
    const { expandable, isOpen, panelId, setIsOpen } = useToolActivity();
    const content = children ?? (_jsxs(_Fragment, { children: [icon ? _jsx("span", { className: "cline-chat-tool-icon", children: icon }) : null, _jsx("span", { className: "cline-chat-tool-label", children: label }), additions !== undefined || deletions !== undefined ? (_jsxs("span", { className: "cline-chat-tool-diff", children: [additions !== undefined ? (_jsxs("span", { "data-diff": "additions", children: ["+", additions] })) : null, " ", deletions !== undefined ? (_jsxs("span", { "data-diff": "deletions", children: ["-", deletions] })) : null] })) : null, status === "running" || status === "pending" ? (_jsx("output", { "aria-label": status, className: "cline-chat-tool-progress" })) : null, expandable ? (_jsx(ChevronDownIcon, { className: "cline-chat-disclosure-icon" })) : null] }));
    const handleClick = (event) => {
        onClick?.(event);
        if (expandable && !event.defaultPrevented)
            setIsOpen(!isOpen);
    };
    const triggerClassName = classNames("cline-chat-tool-trigger", className);
    if (expandable) {
        return (_jsx("button", { ...props, "aria-controls": panelId, "aria-expanded": isOpen, className: triggerClassName, "data-status": status, disabled: disabled, onClick: handleClick, type: "button", children: content }));
    }
    return (_jsx("div", { ...props, className: triggerClassName, "data-status": status, children: content }));
};
export const ToolActivityContent = ({ className, ...props }) => {
    const { expandable, isOpen, panelId } = useToolActivity();
    if (!expandable || !isOpen)
        return null;
    return (_jsx("div", { ...props, className: classNames("cline-chat-tool-content", className), id: panelId }));
};
export const ToolActivityDetails = ({ className, ...props }) => (_jsx("div", { className: classNames("cline-chat-tool-details", className), ...props }));
export const ToolActivityCode = ({ className, ...props }) => (_jsx("pre", { className: classNames("cline-chat-tool-code", className), ...props }));
function ChevronDownIcon({ className }) {
    return (_jsx("svg", { "aria-hidden": "true", className: className, fill: "none", height: "16", viewBox: "0 0 24 24", width: "16", children: _jsx("path", { d: "m6 9 6 6 6-6", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "2" }) }));
}
function BrainIcon() {
    return (_jsx("svg", { "aria-hidden": "true", fill: "none", height: "16", viewBox: "0 0 24 24", width: "16", children: _jsx("path", { d: "M9.5 4.5A3 3 0 0 0 4 6a3 3 0 0 0 .5 5.9A3.5 3.5 0 0 0 8 17h1.5m5-12.5A3 3 0 0 1 20 6a3 3 0 0 1-.5 5.9A3.5 3.5 0 0 1 16 17h-1.5M9.5 4.5V20m5-15.5V20M9.5 9H7m7.5 3H17m-7.5 4H7m7.5 1h2", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "1.75" }) }));
}
//# sourceMappingURL=index.js.map