import type { HTMLAttributes } from "react";
import { forwardRef } from "react";
import { cx } from "./utils.js";

export const AgentSurface = forwardRef<
	HTMLDivElement,
	HTMLAttributes<HTMLDivElement>
>(function AgentSurface({ className, ...props }, ref) {
	return (
		<div
			className={cx("cline-ui-agent-surface", className)}
			ref={ref}
			{...props}
		/>
	);
});
