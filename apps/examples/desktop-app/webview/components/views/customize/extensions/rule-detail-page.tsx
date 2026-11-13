"use client";

import { Badge, DetailList, DetailListItem } from "@cline/ui";
import { FileText } from "lucide-react";
import type { RuleItem } from "@/lib/extension-inventory";
import { CustomizationDetailPage } from "../shared/customization-detail-page";
import { CustomizationItemDetails } from "../shared/customization-item-details";
import { InstalledInstructionFilePreview } from "../shared/installed-instruction-file-preview";
import { PathDetailListItem } from "../shared/path-detail-list-item";
import type { ItemScope } from "./extension-section-shared";

export type RuleSelection = {
	rule: RuleItem;
	scope: ItemScope;
};

export function RuleDetailPage({
	selection: { rule, scope },
	onBack,
	backLabel = "Manage",
}: {
	selection: RuleSelection;
	onBack: () => void;
	backLabel?: string;
}) {
	return (
		<CustomizationDetailPage
			backLabel={backLabel}
			onBack={onBack}
			navigationLabel="Rule navigation"
		>
			<CustomizationItemDetails
				title={rule.name}
				header={(titleRef) => (
					<>
						<Badge
							variant="ghost"
							size="xs"
							tone="neutral"
							className="-ml-1.5 self-start"
						>
							<FileText aria-hidden="true" />
							Rule
						</Badge>
						<h2
							ref={titleRef}
							className="wrap-break-word min-w-0 font-semibold text-2xl text-foreground"
						>
							{rule.name}
						</h2>
					</>
				)}
				actions={null}
				categories={[]}
			>
				<DetailList aria-label="Installed rule details">
					<DetailListItem title="Scope" trailingText={scope} />
					<PathDetailListItem
						path={rule.path}
						label="Rule path"
						title="Path"
						trailingText={<span className="break-all">{rule.path}</span>}
					/>
				</DetailList>
				<InstalledInstructionFilePreview
					path={rule.path}
					instructions={rule.instructions}
					type="rule"
				/>
			</CustomizationItemDetails>
		</CustomizationDetailPage>
	);
}
