import {
	Children,
	type ComponentPropsWithoutRef,
	Fragment,
	isValidElement,
	type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

function hasRenderableChildren(children: ReactNode): boolean {
	return Children.toArray(children).some((child) => {
		if (
			isValidElement<{ children?: ReactNode }>(child) &&
			child.type === Fragment
		) {
			return hasRenderableChildren(child.props.children);
		}
		return true;
	});
}

/** Size card columns to the available content area, including beside a detail pane. */
export function PageCardGrid({
	children,
	className,
	gridClassName,
	...props
}: ComponentPropsWithoutRef<"div"> & { gridClassName?: string }) {
	if (!hasRenderableChildren(children)) return null;

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
