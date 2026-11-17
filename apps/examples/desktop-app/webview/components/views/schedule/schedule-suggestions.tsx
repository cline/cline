import { Badge, ItemCard, SectionHeading } from "@cline/ui";
import { useRef } from "react";
import { useScrollHeaderFade } from "@/hooks/use-scroll-header-fade";
import { PageCardGrid } from "../shared/page-card-grid";
import type { ScheduleTemplate } from "./schedule-templates";

export function ScheduleSuggestions({
	templates,
	onSelect,
}: {
	templates: ScheduleTemplate[];
	onSelect: (template: ScheduleTemplate, trigger?: HTMLButtonElement) => void;
}) {
	const headingRef = useRef<HTMLDivElement>(null);
	useScrollHeaderFade(headingRef, templates.length > 0);
	if (templates.length === 0) return null;

	return (
		<section aria-labelledby="suggested-schedules-heading" className="min-w-0">
			<SectionHeading
				ref={headingRef}
				className="sticky top-(--page-header-height) z-10 -my-2 mb-3 bg-background py-2"
				title={<span id="suggested-schedules-heading">Suggested</span>}
			/>
			<PageCardGrid gridClassName="mb-0 p-0">
				{templates.map((template) => {
					const Icon = template.icon;
					return (
						<ItemCard
							key={template.id}
							title={template.title}
							description={template.description}
							icon={<Icon className="size-4.5" />}
							actions={
								<Badge>
									{template.scheduleType === "daily" ? "Daily" : "Weekly"}
								</Badge>
							}
							primaryAction={{
								onClick: (event) => onSelect(template, event.currentTarget),
							}}
						/>
					);
				})}
			</PageCardGrid>
		</section>
	);
}
