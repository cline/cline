"use client";

import { clsx } from "clsx";
import { type ComponentPropsWithoutRef, forwardRef } from "react";

export type DetailListProps = ComponentPropsWithoutRef<"dl">;

/** A bordered description list. Compose direct DetailListItem children. */
export const DetailList = forwardRef<HTMLDListElement, DetailListProps>(
	function DetailList({ className, ...props }, ref) {
		return (
			<dl
				{...props}
				ref={ref}
				className={clsx("cline-ui-detail-list", className)}
				data-slot="detail-list"
			/>
		);
	},
);
