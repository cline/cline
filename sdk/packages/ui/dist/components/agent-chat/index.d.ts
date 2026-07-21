import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
export type ConversationProps = HTMLAttributes<HTMLDivElement>;
export declare const Conversation: import("react").ForwardRefExoticComponent<ConversationProps & import("react").RefAttributes<HTMLDivElement>>;
export type ConversationViewportProps = Omit<HTMLAttributes<HTMLDivElement>, "role">;
export declare const ConversationViewport: import("react").ForwardRefExoticComponent<ConversationViewportProps & import("react").RefAttributes<HTMLDivElement>>;
export type ConversationContentProps = HTMLAttributes<HTMLDivElement>;
export declare const ConversationContent: import("react").ForwardRefExoticComponent<ConversationContentProps & import("react").RefAttributes<HTMLDivElement>>;
export type ConversationEmptyStateProps = HTMLAttributes<HTMLDivElement> & {
    title?: string;
    description?: string;
    icon?: ReactNode;
};
export declare const ConversationEmptyState: ({ children, className, description, icon, title, ...props }: ConversationEmptyStateProps) => import("react/jsx-runtime").JSX.Element;
export type ConversationScrollButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">;
export declare const ConversationScrollButton: ({ "aria-label": ariaLabel, children, className, onClick, ...props }: ConversationScrollButtonProps) => import("react/jsx-runtime").JSX.Element | null;
export type AgentMessageRole = "user" | "assistant" | "system" | "status" | "error";
export type MessageProps = HTMLAttributes<HTMLDivElement> & {
    from: AgentMessageRole;
};
export declare const Message: ({ className, from, ...props }: MessageProps) => import("react/jsx-runtime").JSX.Element;
export type MessageContentProps = HTMLAttributes<HTMLDivElement>;
export declare const MessageContent: ({ className, ...props }: MessageContentProps) => import("react/jsx-runtime").JSX.Element;
export type MessageActionsProps = HTMLAttributes<HTMLDivElement> & {
    visible?: boolean;
};
export declare const MessageActions: ({ className, visible, ...props }: MessageActionsProps) => import("react/jsx-runtime").JSX.Element;
export type MessageActionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
    label: string;
};
export declare const MessageAction: ({ "aria-label": ariaLabel, className, label, ...props }: MessageActionProps) => import("react/jsx-runtime").JSX.Element;
export type ReasoningProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
    isStreaming?: boolean;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
};
export declare const Reasoning: ({ className, defaultOpen, isStreaming, onOpenChange, open, ...props }: ReasoningProps) => import("react/jsx-runtime").JSX.Element;
export type ReasoningTriggerProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-controls" | "aria-expanded" | "type"> & {
    completeLabel?: string;
    streamingLabel?: string;
};
export declare const ReasoningTrigger: ({ children, className, completeLabel, onClick, streamingLabel, ...props }: ReasoningTriggerProps) => import("react/jsx-runtime").JSX.Element;
export type ReasoningContentProps = Omit<HTMLAttributes<HTMLDivElement>, "hidden" | "id">;
export declare const ReasoningContent: ({ className, ...props }: ReasoningContentProps) => import("react/jsx-runtime").JSX.Element | null;
export type ToolActivityStatus = "pending" | "running" | "success" | "error";
export type ToolActivityProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
    expandable?: boolean;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
};
export declare const ToolActivity: ({ className, defaultOpen, expandable, onOpenChange, open, ...props }: ToolActivityProps) => import("react/jsx-runtime").JSX.Element;
export type ToolActivityTriggerProps = Omit<HTMLAttributes<HTMLElement>, "aria-controls" | "aria-expanded"> & {
    icon?: ReactNode;
    label: ReactNode;
    status?: ToolActivityStatus;
    additions?: number;
    deletions?: number;
    disabled?: boolean;
};
export declare const ToolActivityTrigger: ({ additions, children, className, deletions, disabled, icon, label, onClick, status, ...props }: ToolActivityTriggerProps) => import("react/jsx-runtime").JSX.Element;
export type ToolActivityContentProps = Omit<HTMLAttributes<HTMLDivElement>, "hidden" | "id">;
export declare const ToolActivityContent: ({ className, ...props }: ToolActivityContentProps) => import("react/jsx-runtime").JSX.Element | null;
export type ToolActivityDetailsProps = HTMLAttributes<HTMLDivElement>;
export declare const ToolActivityDetails: ({ className, ...props }: ToolActivityDetailsProps) => import("react/jsx-runtime").JSX.Element;
export type ToolActivityCodeProps = HTMLAttributes<HTMLPreElement>;
export declare const ToolActivityCode: ({ className, ...props }: ToolActivityCodeProps) => import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=index.d.ts.map