import { Children, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/** Size card columns to the available content area, including beside a detail pane. */
export function PageCardGrid({
	children,
	className,
	gridClassName,
	...props
}: ComponentPropsWithoutRef<"div"> & { gridClassName?: string }) {
	if (Children.toArray(children).length === 0) return null;

	return (
		<div {...props} className={cn("@container/page-cards min-w-0", className)}>
			<div
				className={cn(
					"mb-6 grid min-w-0 @min-[640px]/page-cards:grid-cols-2 grid-cols-1 items-start gap-4 p-0.5",
					gridClassName,
				)}
			>
				{children}
			</div>
		</div>
	);
}
