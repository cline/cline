import type { ReactNode } from "react";
export interface AgentQuickAction {
    description: string;
    disabled?: boolean;
    id: string;
    label: string;
    value: string;
}
export interface AgentQuickActionsProps {
    actions: AgentQuickAction[];
    className?: string;
    disabled?: boolean;
    onSelect: (action: AgentQuickAction) => void;
    trailingIcon?: ReactNode;
}
export declare function AgentQuickActions({ actions, className, disabled, onSelect, trailingIcon, }: AgentQuickActionsProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=quick-actions.d.ts.map