"use client";

import {
	PillSelector,
	PillSelectorItem,
	type PillSelectorItemProps,
	type PillSelectorProps,
} from "@cline/ui";
import { LayoutGroup, MotionConfig, motion } from "motion/react";
import {
	createContext,
	type ReactNode,
	type RefObject,
	useContext,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";

const MotionPillSelector = motion.create(PillSelector);
const MotionPillSelectorItem = motion.create(PillSelectorItem);
const CategoryTransitionContext = createContext<{
	enabled: boolean;
	scrollLeft: RefObject<number>;
} | null>(null);
// Motion uses these names for gesture/animation callbacks rather than DOM events.
type MotionEventNames =
	| "onDrag"
	| "onDragStart"
	| "onDragEnd"
	| "onAnimationStart";
const CATEGORY_IDS: Record<string, string> = {
	connector: "connectors",
	plugin: "plugins",
	skill: "skills",
};
const LAYOUT_TRANSITION = {
	type: "spring",
	stiffness: 400,
	damping: 35,
	mass: 1,
} as const;

export function CustomizeCategoryTransitionProvider({
	view,
	children,
}: {
	view: "browse" | "manage" | null;
	children: ReactNode;
}) {
	const id = useId();
	const scrollLeft = useRef(0);
	const enabled = view !== null;
	const context = useMemo(() => ({ enabled, scrollLeft }), [enabled]);
	return (
		<MotionConfig reducedMotion="user">
			<LayoutGroup id={id}>
				<CategoryTransitionContext.Provider value={context}>
					{children}
				</CategoryTransitionContext.Provider>
			</LayoutGroup>
		</MotionConfig>
	);
}

export function CustomizePillSelector({
	page,
	onScroll,
	...props
}: Omit<PillSelectorProps, MotionEventNames> & { page: "browse" | "manage" }) {
	const context = useContext(CategoryTransitionContext);
	const rootRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const root = rootRef.current;
		if (!root || !context?.enabled) return;
		root.scrollLeft = context.scrollLeft.current;
		return () => {
			// Hidden pages report zero even when the user had scrolled the bar.
			if (root.getClientRects().length > 0)
				context.scrollLeft.current = root.scrollLeft;
		};
	}, [context]);
	return (
		<MotionPillSelector
			{...props}
			data-customize-category-page={page}
			layoutScroll
			onScroll={(event) => {
				if (context?.enabled && event.currentTarget.getClientRects().length > 0)
					context.scrollLeft.current = event.currentTarget.scrollLeft;
				onScroll?.(event);
			}}
			ref={rootRef}
		/>
	);
}

/** Animate changed positions, keeping labels anchored when only their counts resize. */
export function CustomizePillSelectorItem({
	category,
	children,
	style,
	...props
}: Omit<PillSelectorItemProps, MotionEventNames> & { category: string }) {
	const enabled = useContext(CategoryTransitionContext)?.enabled ?? false;
	const id = `category-${CATEGORY_IDS[category] ?? category}`;
	return (
		<MotionPillSelectorItem
			{...props}
			data-customize-category={category}
			initial={false}
			layout={enabled ? "position" : false}
			layoutId={enabled ? id : undefined}
			style={{ ...style, borderRadius: 9999 }}
			transition={{ layout: LAYOUT_TRANSITION }}
		>
			<span className="inline-flex items-center" style={{ gap: "inherit" }}>
				{children}
			</span>
		</MotionPillSelectorItem>
	);
}
