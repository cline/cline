"use client";

import { Cable, Puzzle, Server, Zap } from "lucide-react";
import { composioLogoUrl } from "@/lib/composio-recipes";

/**
 * Design-exploration data layer for the marketplace variations.
 *
 * Every variation renders the same unified `MarketplaceItem` list so they can
 * be compared on layout alone. Catalog entries come from the real marketplace
 * catalog (via the existing /api/marketplace/catalog route); connectors are a
 * fixture because the Composio catalog needs an entitled Cline account.
 */

export type ItemKind = "skill" | "mcp" | "plugin" | "connector";

export type MarketplaceItem = {
	key: string;
	kind: ItemKind;
	name: string;
	tagline: string;
	description: string;
	categories: string[];
	author?: string;
	verified?: boolean;
	featured?: boolean;
	icon?: string;
	installed: boolean;
	toolsCount?: number;
	/** What the user has to do after clicking Install. */
	setup: "none" | "env" | "oauth";
	homepage?: string;
};

export type KindMeta = {
	label: string;
	plural: string;
	icon: typeof Server;
	/** One-line answer to "what is this and why would I pick it". */
	blurb: string;
	/** Tailwind classes for the kind's tint (text / soft background / ring). */
	text: string;
	bg: string;
	ring: string;
	dot: string;
};

export const KIND_ORDER: ItemKind[] = ["skill", "mcp", "plugin", "connector"];

export const KIND_META: Record<ItemKind, KindMeta> = {
	skill: {
		label: "Skill",
		plural: "Skills",
		icon: Zap,
		blurb: "Step-by-step instructions Cline follows for a workflow. No setup.",
		text: "text-amber-600 dark:text-amber-300",
		bg: "bg-amber-500/12",
		ring: "ring-amber-500/25",
		dot: "bg-amber-400",
	},
	mcp: {
		label: "MCP server",
		plural: "MCP servers",
		icon: Server,
		blurb: "Live tools from an external server. You install and configure it.",
		text: "text-sky-600 dark:text-sky-300",
		bg: "bg-sky-500/12",
		ring: "ring-sky-500/25",
		dot: "bg-sky-400",
	},
	plugin: {
		label: "Plugin",
		plural: "Plugins",
		icon: Puzzle,
		blurb: "A bundle of tools, hooks, and skills built for Cline.",
		text: "text-violet-600 dark:text-violet-300",
		bg: "bg-violet-500/12",
		ring: "ring-violet-500/25",
		dot: "bg-violet-400",
	},
	connector: {
		label: "Connector",
		plural: "Connectors",
		icon: Cable,
		blurb: "Sign in with your account and get hosted tools instantly. No keys.",
		text: "text-emerald-600 dark:text-emerald-300",
		bg: "bg-emerald-500/12",
		ring: "ring-emerald-500/25",
		dot: "bg-emerald-400",
	},
};

/** Keys that render as installed in every variation. */
const INSTALLED_KEYS = new Set([
	"mcp:context7",
	"plugin:web-search",
	"skill:frontend-design",
	"connector:github",
	"connector:gmail",
]);

type ConnectorFixture = {
	slug: string;
	name: string;
	description: string;
	categories: string[];
	toolsCount: number;
};

/** Representative slice of the Composio toolkit catalog (real slugs + logos). */
const CONNECTOR_FIXTURES: ConnectorFixture[] = [
	{
		slug: "gmail",
		name: "Gmail",
		description: "Read, search, draft, and send email from your Gmail account.",
		categories: ["Productivity"],
		toolsCount: 23,
	},
	{
		slug: "googlecalendar",
		name: "Google Calendar",
		description: "List, create, and update events on your Google Calendar.",
		categories: ["Productivity"],
		toolsCount: 14,
	},
	{
		slug: "github",
		name: "GitHub",
		description: "Work with issues, pull requests, and repositories on GitHub.",
		categories: ["Software Development"],
		toolsCount: 112,
	},
	{
		slug: "slack",
		name: "Slack",
		description:
			"A messaging platform for teams: channels, threads, and direct messages.",
		categories: ["Productivity"],
		toolsCount: 38,
	},
	{
		slug: "linear",
		name: "Linear",
		description: "Issue tracking and project planning for software teams.",
		categories: ["Software Development"],
		toolsCount: 27,
	},
	{
		slug: "notion",
		name: "Notion",
		description: "Connected workspace for docs, wikis, and databases.",
		categories: ["Research & Docs"],
		toolsCount: 19,
	},
	{
		slug: "figma",
		name: "Figma",
		description: "A collaborative interface design tool.",
		categories: ["Creative & Design"],
		toolsCount: 9,
	},
	{
		slug: "sentry",
		name: "Sentry",
		description: "Application monitoring and error tracking.",
		categories: ["Software Development"],
		toolsCount: 21,
	},
	{
		slug: "jira",
		name: "Jira",
		description: "Issue tracking and agile project management from Atlassian.",
		categories: ["Software Development"],
		toolsCount: 44,
	},
	{
		slug: "asana",
		name: "Asana",
		description: "Work management for teams: tasks, projects, and goals.",
		categories: ["Productivity"],
		toolsCount: 31,
	},
	{
		slug: "hubspot",
		name: "HubSpot",
		description: "CRM, marketing, and sales platform.",
		categories: ["Sales", "Marketing"],
		toolsCount: 52,
	},
	{
		slug: "salesforce",
		name: "Salesforce",
		description: "Customer relationship management platform.",
		categories: ["Sales"],
		toolsCount: 36,
	},
	{
		slug: "stripe",
		name: "Stripe",
		description: "Payments infrastructure for the internet.",
		categories: ["Finance"],
		toolsCount: 48,
	},
	{
		slug: "googledrive",
		name: "Google Drive",
		description: "Store, share, and search files in Google Drive.",
		categories: ["Productivity"],
		toolsCount: 17,
	},
	{
		slug: "dropbox",
		name: "Dropbox",
		description: "File hosting and sync.",
		categories: ["Productivity"],
		toolsCount: 12,
	},
	{
		slug: "discord",
		name: "Discord",
		description: "Voice, video, and text chat for communities.",
		categories: ["Productivity"],
		toolsCount: 16,
	},
	{
		slug: "trello",
		name: "Trello",
		description: "Kanban boards for organizing work.",
		categories: ["Productivity"],
		toolsCount: 29,
	},
	{
		slug: "zendesk",
		name: "Zendesk",
		description: "Customer support ticketing and help center.",
		categories: ["Business Operations"],
		toolsCount: 33,
	},
	{
		slug: "airtable",
		name: "Airtable",
		description: "Spreadsheet-database hybrid for teams.",
		categories: ["Data & Analytics"],
		toolsCount: 15,
	},
	{
		slug: "shopify",
		name: "Shopify",
		description: "Commerce platform for online stores.",
		categories: ["Business Operations"],
		toolsCount: 41,
	},
	{
		slug: "twilio",
		name: "Twilio",
		description: "Programmable SMS, voice, and messaging.",
		categories: ["Software Development"],
		toolsCount: 11,
	},
	{
		slug: "youtube",
		name: "YouTube",
		description: "Search, upload, and manage videos and channels.",
		categories: ["Marketing"],
		toolsCount: 13,
	},
	{
		slug: "reddit",
		name: "Reddit",
		description: "Browse, post, and comment on Reddit.",
		categories: ["Marketing"],
		toolsCount: 10,
	},
	{
		slug: "linkedin",
		name: "LinkedIn",
		description: "Professional network: posts, profiles, and companies.",
		categories: ["Marketing", "Sales"],
		toolsCount: 8,
	},
	{
		slug: "intercom",
		name: "Intercom",
		description: "Customer messaging and support inbox.",
		categories: ["Business Operations"],
		toolsCount: 26,
	},
	{
		slug: "zoom",
		name: "Zoom",
		description: "Video meetings, recordings, and transcripts.",
		categories: ["Productivity"],
		toolsCount: 18,
	},
	{
		slug: "supabase",
		name: "Supabase",
		description: "Postgres database, auth, and storage.",
		categories: ["Databases"],
		toolsCount: 22,
	},
	{
		slug: "vercel",
		name: "Vercel",
		description: "Deployments, projects, and domains.",
		categories: ["Software Development"],
		toolsCount: 20,
	},
	{
		slug: "todoist",
		name: "Todoist",
		description: "Personal task manager.",
		categories: ["Productivity"],
		toolsCount: 14,
	},
	{
		slug: "posthog",
		name: "PostHog",
		description: "Product analytics, feature flags, and session replay.",
		categories: ["Data & Analytics"],
		toolsCount: 25,
	},
];

function connectorItems(): MarketplaceItem[] {
	return CONNECTOR_FIXTURES.map((fixture) => {
		const key = `connector:${fixture.slug}`;
		return {
			key,
			kind: "connector",
			name: fixture.name,
			tagline: fixture.description,
			description: `${fixture.description} Sign in with your ${fixture.name} account; Cline gets ${fixture.toolsCount} hosted tools in new sessions.`,
			categories: fixture.categories,
			author: "Composio",
			verified: true,
			icon: composioLogoUrl(fixture.slug),
			installed: INSTALLED_KEYS.has(key),
			toolsCount: fixture.toolsCount,
			setup: "oauth",
		};
	});
}

type RawCatalog = {
	tags?: { id: string; label: string }[];
	entries?: {
		id: string;
		type: "skill" | "mcp" | "plugin";
		name: string;
		tagline: string;
		description: string;
		tags?: string[];
		author?: { name: string };
		verified?: boolean;
		featured?: boolean;
		icon?: string;
		homepage?: string;
		repo?: string;
		install?: { env?: unknown[] };
	}[];
};

export async function loadMarketplaceItems(): Promise<MarketplaceItem[]> {
	const response = await fetch("/api/marketplace/catalog", {
		headers: { Accept: "application/json" },
	});
	const raw = (await response.json()) as RawCatalog;
	const tagLabels = new Map(
		(raw.tags ?? []).map((tag) => [tag.id, tag.label] as const),
	);
	const catalog: MarketplaceItem[] = (raw.entries ?? []).map((entry) => {
		const key = `${entry.type}:${entry.id}`;
		return {
			key,
			kind: entry.type,
			name: entry.name,
			tagline: entry.tagline,
			description: entry.description,
			categories: (entry.tags ?? []).map((tag) => tagLabels.get(tag) ?? tag),
			author: entry.author?.name,
			verified: entry.verified,
			featured: entry.featured,
			icon: entry.icon,
			installed: INSTALLED_KEYS.has(key),
			setup: entry.install?.env?.length ? "env" : "none",
			homepage: entry.homepage ?? entry.repo,
		};
	});
	return [...catalog, ...connectorItems()];
}

export function itemMatches(item: MarketplaceItem, query: string): boolean {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return true;
	return [
		item.name,
		item.tagline,
		item.description,
		item.author ?? "",
		KIND_META[item.kind].label,
		...item.categories,
	]
		.join(" ")
		.toLowerCase()
		.includes(normalized);
}

export function countByKind(items: MarketplaceItem[]): Map<ItemKind, number> {
	const counts = new Map<ItemKind, number>();
	for (const item of items) {
		counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
	}
	return counts;
}

export function allCategories(items: MarketplaceItem[]): string[] {
	const counts = new Map<string, number>();
	for (const item of items) {
		for (const category of item.categories) {
			counts.set(category, (counts.get(category) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([category]) => category);
}

/** Featured entries first, then verified, then alphabetical. */
export function sortItems(items: MarketplaceItem[]): MarketplaceItem[] {
	return [...items].sort(
		(a, b) =>
			Number(Boolean(b.featured)) - Number(Boolean(a.featured)) ||
			Number(Boolean(b.verified)) - Number(Boolean(a.verified)) ||
			a.name.localeCompare(b.name),
	);
}

/** Normalizes a display name so "GitHub" (MCP) and "GitHub" (connector) collide. */
export function serviceKey(name: string): string {
	return name
		.toLowerCase()
		.replace(/\b(mcp|server|connector|skills?|plugin|docs|cli|sdk)\b/g, "")
		.replace(/[^a-z0-9]/g, "");
}
