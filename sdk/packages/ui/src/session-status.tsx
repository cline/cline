import type { OutputHTMLAttributes } from "react";
import { cx } from "./utils.js";

export type SessionStatusTone =
	| "neutral"
	| "provisioning"
	| "running"
	| "success"
	| "error";

export interface SessionStatusProps
	extends OutputHTMLAttributes<HTMLOutputElement> {
	label: string;
	showLabel?: boolean;
	tone?: SessionStatusTone;
}

export function SessionStatus({
	className,
	label,
	showLabel = true,
	tone = "neutral",
	...props
}: SessionStatusProps) {
	return (
		<output
			aria-label={label}
			className={cx(
				"cline-ui-session-status",
				`cline-ui-session-status--${tone}`,
				className,
			)}
			{...props}
		>
			<span aria-hidden="true" className="cline-ui-session-status__dot" />
			<span className={showLabel ? undefined : "cline-ui-sr-only"}>
				{label}
			</span>
		</output>
	);
}
