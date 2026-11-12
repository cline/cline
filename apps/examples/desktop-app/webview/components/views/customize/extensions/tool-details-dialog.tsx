import {
	Badge,
	DetailList,
	DetailListItem,
	Dialog,
	SectionHeading,
	Switch,
} from "@cline/ui";
import { useId } from "react";
import type { ToolItem } from "@/lib/extension-inventory";
import { WebSearchProviderGuidance } from "../../settings/web-search-provider-guidance";
import { CustomizationDescription } from "../shared/customization-description";
import { PathDetailListItem } from "../shared/path-detail-list-item";
export function ToolDetailsDialog({
	tool,
	busy,
	error,
	onClose,
	onRestoreFocus,
	onToggle,
	onOpenModelProviders,
}: {
	tool?: ToolItem;
	busy: boolean;
	error?: string;
	onClose: () => void;
	onRestoreFocus: (event: Event) => void;
	onToggle: (tool: ToolItem) => Promise<void>;
	onOpenModelProviders?: () => void;
}) {
	const toggleId = useId();

	return (
		<Dialog
			open={tool !== undefined}
			onCloseAutoFocus={onRestoreFocus}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title={tool?.name ?? "Tool details"}
			description={tool?.source === "builtin" ? "Built-in tool" : "Plugin tool"}
			className="select-text"
			footer={
				tool ? (
					<div className="flex w-full flex-wrap items-center gap-3">
						{Boolean(error) && (
							<p role="alert" className="flex-1 text-error-text text-sm">
								{error}
							</p>
						)}
						<label
							className="ml-auto inline-flex cursor-pointer items-center gap-3 text-sm"
							htmlFor={toggleId}
						>
							Enable
							<Switch
								id={toggleId}
								checked={tool.enabled}
								onCheckedChange={() => {
									void onToggle(tool);
								}}
								disabled={busy}
							/>
						</label>
					</div>
				) : undefined
			}
		>
			{tool && (
				<div className="wrap-anywhere space-y-5 text-sm">
					<CustomizationDescription className="whitespace-pre-wrap leading-relaxed">
						{tool.description?.trim() || "No description available."}
					</CustomizationDescription>
					{tool.source === "builtin" && tool.id === "web_search" && (
						<WebSearchProviderGuidance
							onOpenModelProviders={
								onOpenModelProviders
									? () => {
											onClose();
											onOpenModelProviders();
										}
									: undefined
							}
						/>
					)}
					{(tool.headlessToolNames?.length ?? 0) > 0 && (
						<div className="space-y-2">
							<SectionHeading
								title="Included tools"
								count={tool.headlessToolNames?.length}
								size="base"
								headingLevel={3}
							/>
							<ul className="flex flex-wrap gap-2">
								{tool.headlessToolNames?.map((name) => (
									<li key={name} className="min-w-0 max-w-full">
										<Badge tone="neutral" className="max-w-full font-mono">
											{name}
										</Badge>
									</li>
								))}
							</ul>
						</div>
					)}
					{(tool.pluginName || tool.path) && (
						<DetailList>
							{tool.pluginName && (
								<DetailListItem title="Plugin" trailingText={tool.pluginName} />
							)}
							{tool.path && (
								<PathDetailListItem
									path={tool.path}
									label="Tool path"
									title="Path"
									trailingText={<span className="font-mono">{tool.path}</span>}
								/>
							)}
						</DetailList>
					)}
				</div>
			)}
		</Dialog>
	);
}
