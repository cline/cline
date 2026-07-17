import type { HTMLAttributes } from "react";
export type SessionStatusTone = "neutral" | "provisioning" | "running" | "success" | "error";
export interface SessionStatusProps extends HTMLAttributes<HTMLSpanElement> {
    label: string;
    tone?: SessionStatusTone;
}
export declare function SessionStatus({ className, label, tone, ...props }: SessionStatusProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=session-status.d.ts.map