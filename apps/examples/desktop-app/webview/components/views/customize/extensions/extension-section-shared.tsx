import { Badge, Banner, IconButton } from "@cline/ui";
import { RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import type { UserInstructionListsResponse } from "@/lib/extension-inventory";
import { useCustomizeRefresh } from "../shared/customize-refresh";
import { CustomizeSectionHeading } from "../shared/customize-section-heading";
import type { ItemScope } from "./installed-inventory-selectors";

export {
	type CommandItem,
	getLocalMarketplaceMatchValues,
	getPathScope,
	type ItemScope,
	matchesSearchQuery,
	normalizePath,
	toolMatchesQuery,
} from "./installed-inventory-selectors";

export type ExtensionSectionProps = {
	includeBuiltinItems?: boolean;
	searchQuery?: string;
	searchResults?: boolean;
	previewLimit?: number;
	itemOffset?: number;
	onInventoryChanged?: () => void;
	onViewAll?: () => void;
};
export const EMPTY_INVENTORY: UserInstructionListsResponse = {
	workspaceRoot: "",
	rules: [],
	workflows: [],
	skills: [],
	agents: [],
	plugins: [],
	tools: [],
	hooks: [],
	warnings: [],
	mcp: { settingsPath: "", hasSettingsFile: false, servers: [] },
};

export function ExtensionSectionLayout({
	title,
	count,
	loading,
	loadError,
	actionError,
	warnings,
	searchResults,
	onViewAll,
	onRefresh,
	children,
}: {
	title: string;
	count?: number;
	loading: boolean;
	/** The inventory could not be read. */
	loadError: string | null;
	/** Something the reader just tried (a toggle, an uninstall) failed. */
	actionError?: string | null;
	warnings: string[];
	searchResults: boolean;
	onViewAll?: () => void;
	onRefresh: () => Promise<void>;
	children: ReactNode;
}) {
	const sharedRefresh = useCustomizeRefresh(onRefresh);
	return (
		<div>
			{!searchResults ? (
				<CustomizeSectionHeading
					className="mb-4"
					title={title}
					count={count}
					headingLevel={3}
					onViewAll={onViewAll}
					actions={
						sharedRefresh ? null : (
							<IconButton
								aria-label={`Refresh ${title.toLowerCase()}`}
								variant="ghost"
								tone="neutral"
								size="sm"
								onClick={() => void onRefresh()}
								disabled={loading}
								icon={RefreshCw}
								loading={loading}
								loadingIcon={RefreshCw}
							/>
						)
					}
				/>
			) : null}
			{actionError ? (
				<Banner className="mb-4" tone="error">
					{actionError}
				</Banner>
			) : loadError ? (
				<Banner className="mb-4" tone="error">
					Failed to load configuration lists: {loadError}
				</Banner>
			) : null}
			{warnings.length > 0 ? (
				<Banner
					className="mb-4"
					icon={<TriangleAlert aria-hidden="true" />}
					title="Partial results"
					tone="warning"
				>
					<ul className="list-disc space-y-1 pl-5">
						{warnings.map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</Banner>
			) : null}
			{children}
		</div>
	);
}

export function previewText(input: string, maxLength = 150): string {
	const compact = input.replace(/\s+/g, " ").trim();
	if (compact.length <= maxLength) {
		return compact;
	}
	return `${compact.slice(0, maxLength).trimEnd()}…`;
}

export function ScopeBadge({ scope }: { scope: ItemScope }) {
	return <Badge tone="neutral">{scope}</Badge>;
}
