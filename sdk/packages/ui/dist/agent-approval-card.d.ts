import type { ReactNode } from "react";
export interface AgentApprovalCardProps {
    approveLabel?: string;
    className?: string;
    description?: ReactNode;
    detail?: ReactNode;
    onApprove: () => void;
    onReject: () => void;
    rejectLabel?: string;
    responding?: boolean;
    title: ReactNode;
}
export declare function AgentApprovalCard({ approveLabel, className, description, detail, onApprove, onReject, rejectLabel, responding, title, }: AgentApprovalCardProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=agent-approval-card.d.ts.map