import type { ReactNode } from "react";
export type AgentActivityStatus = "idle" | "running" | "success" | "error";
export interface AgentActivityProps {
    children?: ReactNode;
    className?: string;
    defaultOpen?: boolean;
    detail?: ReactNode;
    icon?: ReactNode;
    label: string;
    status?: AgentActivityStatus;
}
export declare function AgentActivity({ children, className, defaultOpen, detail, icon, label, status, }: AgentActivityProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=agent-activity.d.ts.map