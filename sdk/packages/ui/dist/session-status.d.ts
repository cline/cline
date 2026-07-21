import type { OutputHTMLAttributes } from "react";
export type SessionStatusTone = "neutral" | "provisioning" | "running" | "success" | "error";
export interface SessionStatusProps extends OutputHTMLAttributes<HTMLOutputElement> {
    label: string;
    showLabel?: boolean;
    tone?: SessionStatusTone;
}
export declare function SessionStatus({ className, label, showLabel, tone, ...props }: SessionStatusProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=session-status.d.ts.map