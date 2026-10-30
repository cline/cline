import { Children, Fragment, isValidElement, type ReactNode } from "react";

/** Check structural slot content without rendering opaque child components. */
export function hasContent(node: ReactNode): boolean {
	return Children.toArray(node).some((child) => {
		if (typeof child === "string") return child.length > 0;
		if (
			isValidElement<{ children?: ReactNode }>(child) &&
			child.type === Fragment
		) {
			return hasContent(child.props.children);
		}
		return true;
	});
}
