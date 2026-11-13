import { Button } from "@cline/ui";
import { ArrowLeft } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { PageFrame } from "../page-layout";
import styles from "./detail-page.module.css";

export type DetailPageProps = {
	backLabel: string;
	onBack: () => void;
	title?: ReactNode;
	navigationLabel?: string;
	backDisabled?: boolean;
	/** Start keyboard focus on Back. Pages that open on a field turn this off. */
	focusBackOnMount?: boolean;
	contentClassName?: string;
	children: ReactNode;
};

/** Shared full-page back navigation and responsive detail content. */
export function DetailPage({
	backLabel,
	onBack,
	title,
	navigationLabel = "Detail navigation",
	backDisabled = false,
	focusBackOnMount = true,
	contentClassName,
	children,
}: DetailPageProps) {
	const backRef = useRef<HTMLButtonElement>(null);
	const titleRef = useRef<HTMLHeadingElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	// Only the first render decides where focus starts.
	const shouldFocusBack = useRef(focusBackOnMount).current;
	const focusedOnMount = useRef(false);
	useLayoutEffect(() => {
		if (!shouldFocusBack || focusedOnMount.current) return;
		focusedOnMount.current = true;
		const target = backDisabled
			? (titleRef.current ?? contentRef.current)
			: backRef.current;
		target?.focus({ preventScroll: true });
	}, [backDisabled, shouldFocusBack]);
	return (
		<PageFrame
			className={styles.frame}
			contentClassName={styles.layout}
			windowTitleBar
		>
			{/* Share the existing header row with window dragging. Tauri's deep
			    regions leave buttons, links, and editable controls interactive. */}
			<div
				className={styles.navigation}
				data-detail-navigation=""
				data-tauri-drag-region="deep"
			>
				{title ? (
					<h1
						ref={titleRef}
						tabIndex={-1}
						className="font-cline-ui-medium text-foreground text-xl outline-none"
					>
						{title}
					</h1>
				) : null}
				<nav aria-label={navigationLabel}>
					<Button
						ref={backRef}
						aria-label={`Back to ${backLabel}`}
						className="-ml-3 gap-2.5"
						onClick={onBack}
						disabled={backDisabled}
						tone="neutral"
						variant="ghost"
						leadingIcon={ArrowLeft}
					>
						{backLabel}
					</Button>
				</nav>
			</div>
			<div
				ref={contentRef}
				tabIndex={-1}
				data-detail-content=""
				className={cn(styles.content, "outline-none", contentClassName)}
			>
				{children}
			</div>
		</PageFrame>
	);
}
