import { Button, SectionHeading, type SectionHeadingProps } from "@cline/ui";
import { ArrowRight } from "lucide-react";
import { useRef } from "react";
import { useScrollHeaderFade } from "@/hooks/use-scroll-header-fade";
import { cn } from "@/lib/utils";

export function CustomizeViewAllButton({ onClick }: { onClick: () => void }) {
	return (
		<Button
			variant="ghost"
			tone="neutral"
			size="sm"
			onClick={onClick}
			trailingIcon={ArrowRight}
		>
			View all
		</Button>
	);
}

export function CustomizeSectionHeading({
	className,
	actions,
	onViewAll,
	...props
}: SectionHeadingProps & { onViewAll?: () => void }) {
	const headingRef = useRef<HTMLDivElement>(null);
	useScrollHeaderFade(headingRef);
	return (
		<SectionHeading
			{...props}
			ref={headingRef}
			actions={
				onViewAll ? (
					<>
						{actions}
						<CustomizeViewAllButton onClick={onViewAll} />
					</>
				) : (
					actions
				)
			}
			className={cn(
				"in-data-customize-sections:bg-background in-data-customize-sections:py-2",
				"in-data-customize-sections:sticky in-data-customize-sections:top-(--customize-section-top) in-data-customize-sections:z-10",
				className,
			)}
		/>
	);
}
