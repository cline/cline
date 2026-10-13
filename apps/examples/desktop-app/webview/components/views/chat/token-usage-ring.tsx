"use client";

import { AgentContextUsage, type AgentContextUsageData } from "@cline/ui";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { formatCostUsd } from "@/hooks/use-session-history";

/** Native popover, trigger styling, and cost formatting remain desktop-owned. */
export function TokenUsageRing({
	usage,
}: {
	usage: AgentContextUsageData & { totalCost?: number };
}) {
	return (
		<AgentContextUsage usage={usage} costLabel={formatCostUsd(usage.totalCost)}>
			{({ triggerLabel, ring, details }) => (
				<Popover>
					<PopoverTrigger asChild>
						<Button
							aria-label={triggerLabel}
							className="size-7 shrink-0 p-0 text-muted-foreground data-[state=open]:bg-surface-hover opacity-65 hover:opacity-100"
							id="token-usage"
							size="icon-sm"
							type="button"
							variant="text"
						>
							{ring}
						</Button>
					</PopoverTrigger>
					<PopoverContent
						align="end"
						className="w-80 p-0"
						id="token-usage-panel"
						side="top"
						sideOffset={8}
					>
						{details}
					</PopoverContent>
				</Popover>
			)}
		</AgentContextUsage>
	);
}
