import { SectionHeading } from "@cline/ui";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";

/** Rarely needed settings, collapsed under an "Advanced" heading that toggles them. */
export function AdvancedSection({
	id,
	open,
	onOpenChange,
	disabled = false,
	children,
}: {
	/** Prefix for the heading (`-heading`) and content (`-options`) element ids. */
	id: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	const headingId = `${id}-heading`;
	const contentId = `${id}-options`;
	return (
		<section aria-labelledby={headingId} className="min-w-0">
			<Collapsible open={open} onOpenChange={onOpenChange}>
				<SectionHeading
					className="-ml-1"
					size="md"
					headingLevel={2}
					title={
						<CollapsibleTrigger asChild>
							<button
								id={headingId}
								type="button"
								aria-controls={contentId}
								disabled={disabled}
								className="group/advanced inline-flex cursor-pointer items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed"
							>
								<ChevronRight
									aria-hidden="true"
									className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded/advanced:rotate-90 motion-reduce:transition-none"
								/>
								Advanced
							</button>
						</CollapsibleTrigger>
					}
				/>
				<CollapsibleContent id={contentId} className="mt-4">
					{children}
				</CollapsibleContent>
			</Collapsible>
		</section>
	);
}
