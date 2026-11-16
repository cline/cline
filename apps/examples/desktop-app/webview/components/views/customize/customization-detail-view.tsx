import type { MarketplaceEntry } from "@/lib/marketplace";
import {
	InstalledPluginDetailPage,
	type InstalledPluginSelection,
} from "./extensions/installed-plugin-detail";
import {
	InstalledSkillDetailPage,
	type InstalledSkillSelection,
} from "./extensions/installed-skill-detail";
import {
	RuleDetailPage,
	type RuleSelection,
} from "./extensions/rule-detail-page";
import {
	WorkflowDetailPage,
	type WorkflowSelection,
} from "./extensions/workflow-detail-page";
import { MarketplaceEntryDetailPage } from "./marketplace/marketplace-entry-detail-page";
import { InstalledMcpDetailPage } from "./mcp/installed-mcp-detail";
import { McpServerEditorPage } from "./mcp/mcp-server-editor-page";
import type { InstalledMcpSelection } from "./mcp/mcp-types";

/** What a detail page shows: one customization, or a new MCP server. */
export type CustomizationDetailSelection =
	| { type: "skill"; selection: InstalledSkillSelection }
	| { type: "workflow"; selection: WorkflowSelection }
	| { type: "rule"; selection: RuleSelection }
	| { type: "mcp"; selection: InstalledMcpSelection }
	| { type: "mcp-create" }
	| { type: "plugin"; selection: InstalledPluginSelection }
	| { type: "marketplace"; entry: MarketplaceEntry };

export type CloseCustomizationDetail = (options?: {
	uninstalled: boolean;
}) => void;

/** One detail page per kind of customization. */
export function CustomizationDetailView({
	selection,
	backLabel,
	onBack,
}: {
	selection: CustomizationDetailSelection;
	backLabel: string;
	onBack: CloseCustomizationDetail;
}) {
	const page = { backLabel, onBack };
	switch (selection.type) {
		case "skill":
			return (
				<InstalledSkillDetailPage selection={selection.selection} {...page} />
			);
		case "rule":
			return <RuleDetailPage selection={selection.selection} {...page} />;
		case "workflow":
			return <WorkflowDetailPage selection={selection.selection} {...page} />;
		case "mcp-create":
			return <McpServerEditorPage {...page} />;
		case "mcp":
			return (
				<InstalledMcpDetailPage selection={selection.selection} {...page} />
			);
		case "plugin":
			return (
				<InstalledPluginDetailPage selection={selection.selection} {...page} />
			);
		case "marketplace":
			return <MarketplaceEntryDetailPage entry={selection.entry} {...page} />;
	}
}
