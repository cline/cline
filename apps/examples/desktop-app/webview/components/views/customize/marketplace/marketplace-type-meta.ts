import { Cable, type LucideIcon, Puzzle, Server, Zap } from "lucide-react";
import type { MarketplacePrimitiveType } from "@/lib/marketplace";

/** Presentation for one marketplace primitive type (skill, MCP, ...). */
export type MarketplaceTypeMeta = {
	label: string;
	plural: string;
	/** The plural as it reads mid-sentence ("No skills installed"). */
	noun: string;
	/** Short pill label where space is tight ("MCP" instead of "MCP server"). */
	short: string;
	icon: LucideIcon;
	/** One-line answer to "what is this and what does adding it involve". */
	blurb: string;
};

export type MarketplaceTypeFilter = MarketplacePrimitiveType | "connector";

export const TYPE_META: Record<MarketplaceTypeFilter, MarketplaceTypeMeta> = {
	skill: {
		label: "Skill",
		plural: "Skills",
		noun: "skills",
		short: "Skill",
		icon: Zap,
		blurb: "Step-by-step instructions Cline follows for a workflow. No setup.",
	},
	mcp: {
		label: "MCP server",
		plural: "MCP servers",
		noun: "MCP servers",
		short: "MCP",
		icon: Server,
		blurb: "Live tools from an external server. You install and configure it.",
	},
	plugin: {
		label: "Plugin",
		plural: "Plugins",
		noun: "plugins",
		short: "Plugin",
		icon: Puzzle,
		blurb: "A bundle of tools, hooks, and skills built for Cline.",
	},
	connector: {
		label: "Connector",
		plural: "Connectors",
		noun: "connectors",
		short: "Connector",
		icon: Cable,
		blurb: "Sign in with your account and get hosted tools instantly. No keys.",
	},
};
