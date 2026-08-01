import type { OutputHTMLAttributes } from "react";

export type SessionStatusTone = "neutral" | "running" | "error";

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
			className={[
				"cline-ui-session-status",
				`cline-ui-session-status--${tone}`,
				className,
			]
				.filter(Boolean)
				.join(" ")}
			{...props}
		>
			<span aria-hidden="true" className="cline-ui-session-status__dot" />
			<span className={showLabel ? undefined : "cline-ui-sr-only"}>
				{label}
			</span>
		</output>
	);
}
