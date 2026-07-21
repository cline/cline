import type { ReactNode, TextareaHTMLAttributes } from "react";
export interface AgentComposerProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
    actions?: ReactNode;
    className?: string;
    footer?: ReactNode;
    loading?: boolean;
    onStop?: () => void;
    onSubmit: () => void;
    onValueChange: (value: string) => void;
    running?: boolean;
    submitDisabled?: boolean;
    submitLabel?: string;
    variant?: "conversation" | "welcome";
    value: string;
}
export declare function AgentComposer({ actions, className, disabled, footer, loading, onKeyDown, onStop, onSubmit, onValueChange, placeholder, running, submitDisabled, submitLabel, variant, value, ...textareaProps }: AgentComposerProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=agent-composer.d.ts.map