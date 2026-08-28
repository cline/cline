import { Puzzle, Server, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	fetchMarketplaceCatalog,
	type MarketplaceCatalog,
	type MarketplaceEntry,
	type MarketplacePrimitiveType,
} from "@/lib/marketplace";
import { cn } from "@/lib/utils";

/**
 * Shared data + primitives for the marketplace design-direction prototypes.
 * Each direction is a standalone view; this module keeps catalog fetching,
 * install state, and the metadata-driven building blocks consistent between
 * them.
 */

/** Ordered most-mature first: skills > MCP servers > plugins. */
export const MATURITY_ORDER: MarketplacePrimitiveType[] = [
	"skill",
	"mcp",
	"plugin",
];

export type TypeMeta = {
	label: string;
	plural: string;
	icon: typeof Server;
	maturity: string;
	blurb: string;
	command: string;
};

export const TYPE_META: Record<MarketplacePrimitiveType, TypeMeta> = {
	skill: {
		label: "Skill",
		plural: "Skills",
		icon: Zap,
		maturity: "Most mature",
		blurb: "Curated instructions that teach the agent proven workflows.",
		command: "cline skill add",
	},
	mcp: {
		label: "MCP Server",
		plural: "MCP Servers",
		icon: Server,
		maturity: "Maturing",
		blurb: "Connect the agent to external tools, APIs, and data sources.",
		command: "cline mcp install",
	},
	plugin: {
		label: "Plugin",
		plural: "Plugins",
		icon: Puzzle,
		maturity: "Early",
		blurb: "Bundled extensions that package skills, hooks, and config.",
		command: "cline plugin install",
	},
};

export function entryKey(entry: Pick<MarketplaceEntry, "id" | "type">): string {
	return `${entry.type}:${entry.id}`;
}

export function learnMoreUrl(entry: MarketplaceEntry): string | undefined {
	return entry.homepage ?? entry.repo;
}

export function openLearnMore(entry: MarketplaceEntry): void {
	const url = learnMoreUrl(entry);
	if (url) void openExternalUrl(url);
}

export function entrySearchText(
	entry: MarketplaceEntry,
	tagLabels: Map<string, string>,
): string {
	return [
		entry.name,
		entry.tagline,
		entry.description,
		entry.type,
		entry.author?.name ?? "",
		...entry.tags.map((tag) => tagLabels.get(tag) ?? tag),
	]
		.join(" ")
		.toLowerCase();
}

export type EntryActionState =
	| { status: "idle" }
	| { status: "installing" }
	| { status: "uninstalling" }
	| { status: "installed"; message: string }
	| { status: "uninstalled"; message: string }
	| { status: "failed"; message: string };

type MarketplaceInstallResult = {
	status: "installed" | "uninstalled";
	message: string;
	output?: string;
};

type MarketplaceInstallStatusResult = {
	installedKeys: string[];
};

const INSTALL_TIMEOUT_MS = 300_000;

export type MarketplaceDirectory = {
	catalog: MarketplaceCatalog | null;
	errorMessage: string | null;
	loading: boolean;
	tagLabels: Map<string, string>;
	installedKeys: Set<string>;
	installedReady: boolean;
	actionStates: Map<string, EntryActionState>;
	install: (entry: MarketplaceEntry) => Promise<void>;
	uninstall: (entry: MarketplaceEntry) => Promise<void>;
};

export function useMarketplaceDirectory(): MarketplaceDirectory {
	const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [installedKeys, setInstalledKeys] = useState<Set<string>>(
		() => new Set(),
	);
	const [installedReady, setInstalledReady] = useState(false);
	const [actionStates, setActionStates] = useState<
		Map<string, EntryActionState>
	>(() => new Map());

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const nextCatalog = await fetchMarketplaceCatalog();
				if (!cancelled) {
					setCatalog(nextCatalog);
					setErrorMessage(null);
				}
			} catch (error) {
				if (!cancelled) {
					setErrorMessage(
						error instanceof Error ? error.message : String(error),
					);
					setInstalledReady(true);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!catalog) return;
		let cancelled = false;
		void (async () => {
			try {
				const response =
					await desktopClient.invoke<MarketplaceInstallStatusResult>(
						"list_marketplace_installed_entries",
						{ entries: catalog.entries },
					);
				if (!cancelled) {
					setInstalledKeys(new Set(response.installedKeys));
				}
			} catch {
				// Keep current installed status when the check fails.
			} finally {
				if (!cancelled) {
					setInstalledReady(true);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [catalog]);

	const tagLabels = useMemo(
		() => new Map(catalog?.tags.map((tag) => [tag.id, tag.label]) ?? []),
		[catalog?.tags],
	);

	const setEntryState = (entry: MarketplaceEntry, state: EntryActionState) => {
		const key = entryKey(entry);
		setActionStates((current) => {
			const next = new Map(current);
			next.set(key, state);
			return next;
		});
	};

	const install = async (entry: MarketplaceEntry) => {
		const key = entryKey(entry);
		const current = actionStates.get(key);
		if (
			current?.status === "installing" ||
			current?.status === "uninstalling"
		) {
			return;
		}
		setEntryState(entry, { status: "installing" });
		try {
			const result = await desktopClient.invoke<MarketplaceInstallResult>(
				"install_marketplace_entry",
				{ entry },
				{ timeoutMs: INSTALL_TIMEOUT_MS },
			);
			setEntryState(entry, { status: "installed", message: result.message });
			setInstalledKeys((prev) => new Set(prev).add(key));
		} catch (error) {
			setEntryState(entry, {
				status: "failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const uninstall = async (entry: MarketplaceEntry) => {
		const key = entryKey(entry);
		const current = actionStates.get(key);
		if (
			current?.status === "installing" ||
			current?.status === "uninstalling"
		) {
			return;
		}
		setEntryState(entry, { status: "uninstalling" });
		try {
			const result = await desktopClient.invoke<MarketplaceInstallResult>(
				"uninstall_marketplace_entry",
				{ entry },
				{ timeoutMs: INSTALL_TIMEOUT_MS },
			);
			setEntryState(entry, { status: "uninstalled", message: result.message });
			setInstalledKeys((prev) => {
				const next = new Set(prev);
				next.delete(key);
				return next;
			});
		} catch (error) {
			setEntryState(entry, {
				status: "failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	return {
		catalog,
		errorMessage,
		loading: !catalog && !errorMessage,
		tagLabels,
		installedKeys,
		installedReady,
		actionStates,
		install,
		uninstall,
	};
}

/**
 * Deterministic hue per entry so monogram tiles stay stable across renders
 * and feel individually branded even when the catalog has no icon URL.
 */
function entryHue(entry: MarketplaceEntry): number {
	let hash = 0;
	const source = entryKey(entry);
	for (let i = 0; i < source.length; i++) {
		hash = (hash * 31 + source.charCodeAt(i)) | 0;
	}
	return Math.abs(hash) % 360;
}

/**
 * Entry artwork: real catalog icon when available, otherwise a colored
 * monogram tile derived from the entry id.
 */
export function EntryGlyph({
	className,
	entry,
	rounded = "rounded-lg",
}: {
	className?: string;
	entry: MarketplaceEntry;
	rounded?: string;
}) {
	const [iconFailed, setIconFailed] = useState(false);
	if (entry.icon && !iconFailed) {
		return (
			<span
				className={cn(
					"flex shrink-0 items-center justify-center overflow-hidden border border-border/60 bg-background p-[15%]",
					rounded,
					className,
				)}
			>
				{/* biome-ignore lint/performance/noImgElement: catalog icons are remote SVG/PNG assets, next/image adds no value here */}
				<img
					alt=""
					className="h-full w-full object-contain"
					onError={() => setIconFailed(true)}
					src={entry.icon}
				/>
			</span>
		);
	}
	const hue = entryHue(entry);
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex shrink-0 select-none items-center justify-center font-semibold text-white",
				rounded,
				className,
			)}
			style={{
				background: `linear-gradient(135deg, hsl(${hue} 65% 52%), hsl(${(hue + 45) % 360} 70% 38%))`,
			}}
		>
			{entry.name.trim().charAt(0).toUpperCase()}
		</span>
	);
}

export function actionLabelFor(
	state: EntryActionState | undefined,
	installed: boolean,
	ready: boolean,
): string {
	if (!ready) return "Checking...";
	if (state?.status === "installing") return "Installing...";
	if (state?.status === "uninstalling") return "Uninstalling...";
	return installed ? "Uninstall" : "Install";
}

export function isBusy(state: EntryActionState | undefined): boolean {
	return state?.status === "installing" || state?.status === "uninstalling";
}
