"use client";

import { PillSelectorItem, type PillSelectorItemProps } from "@cline/ui";
import { LayoutGroup, MotionConfig, motion } from "motion/react";
import { createContext, type ReactNode, useContext, useId } from "react";

const MotionPillSelectorItem = motion.create(PillSelectorItem);
const CategoryTransitionContext = createContext(false);
// Motion uses these names for gesture/animation callbacks rather than DOM events.
type MotionEventNames =
	| "onDrag"
	| "onDragStart"
	| "onDragEnd"
	| "onAnimationStart";
const LAYOUT_TRANSITION = {
	type: "spring",
	stiffness: 400,
	damping: 35,
	mass: 1,
} as const;

export function CustomizeCategoryTransitionProvider({
	enabled,
	children,
}: {
	enabled: boolean;
	children: ReactNode;
}) {
	const id = useId();
	return (
		<MotionConfig reducedMotion="user">
			<LayoutGroup id={id}>
				<CategoryTransitionContext.Provider value={enabled}>
					{children}
				</CategoryTransitionContext.Provider>
			</LayoutGroup>
		</MotionConfig>
	);
}

/** Animate changed positions, keeping labels anchored when only their counts resize. */
export function CustomizePillSelectorItem({
	value,
	children,
	style,
	...props
}: Omit<PillSelectorItemProps, MotionEventNames>) {
	const enabled = useContext(CategoryTransitionContext);
	return (
		<MotionPillSelectorItem
			{...props}
			value={value}
			data-customize-category={value}
			initial={false}
			layout={enabled ? "position" : false}
			layoutId={enabled ? `category-${value}` : undefined}
			style={{ ...style, borderRadius: 9999 }}
			transition={{ layout: LAYOUT_TRANSITION }}
		>
			<span className="inline-flex items-center" style={{ gap: "inherit" }}>
				{children}
			</span>
		</MotionPillSelectorItem>
	);
}
