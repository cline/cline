import type { HTMLAttributes } from "react";
import { cx } from "./utils.js";

export type SessionStatusTone =
	| "neutral"
	| "provisioning"
	| "running"
	| "success"
	| "error";

export interface SessionStatusProps extends HTMLAttributes<HTMLSpanElement> {
	label: string;
	tone?: SessionStatusTone;
}

export function SessionStatus({
	className,
	label,
	tone = "neutral",
	...props
}: SessionStatusProps) {
	return (
		<span
			className={cx(
				"cline-ui-session-status",
				`cline-ui-session-status--${tone}`,
				className,
			)}
			{...props}
		>
			<span aria-hidden="true" className="cline-ui-session-status__dot" />
			{label}
		</span>
	);
}
