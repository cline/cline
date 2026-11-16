import { Cable, type LucideIcon, Puzzle, Server, Zap } from "lucide-react";
import type { MarketplacePrimitiveType } from "@/lib/marketplace";

/** Presentation for one marketplace primitive type (skill, MCP, ...). */
export type MarketplaceTypeMeta = {
	plural: string;
	/** The plural as it reads mid-sentence ("No skills installed"). */
	noun: string;
	/** Short pill label where space is tight ("MCP" instead of "MCP server"). */
	short: string;
	icon: LucideIcon;
};

export type MarketplaceTypeFilter = MarketplacePrimitiveType | "connector";

export const TYPE_META: Record<MarketplaceTypeFilter, MarketplaceTypeMeta> = {
	skill: {
		plural: "Skills",
		noun: "skills",
		short: "Skill",
		icon: Zap,
	},
	mcp: {
		plural: "MCP servers",
		noun: "MCP servers",
		short: "MCP",
		icon: Server,
	},
	plugin: {
		plural: "Plugins",
		noun: "plugins",
		short: "Plugin",
		icon: Puzzle,
	},
	connector: {
		plural: "Connectors",
		noun: "connectors",
		short: "Connector",
		icon: Cable,
	},
};
