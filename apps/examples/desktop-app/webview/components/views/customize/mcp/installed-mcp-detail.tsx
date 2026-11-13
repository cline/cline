"use client";

import { MarketplaceEntryDetailPage } from "../marketplace/marketplace-entry-detail-page";
import { McpServerEditorPage } from "./mcp-server-editor-page";
import type { InstalledMcpSelection } from "./mcp-types";
import type { McpEditorBack } from "./use-mcp-server-editor";

export function InstalledMcpDetailPage({
	selection,
	onBack,
	backLabel = "Manage",
}: {
	selection: InstalledMcpSelection;
	onBack: McpEditorBack;
	backLabel?: string;
}) {
	if (!selection.server) {
		return (
			<MarketplaceEntryDetailPage
				entry={selection.entry}
				backLabel={backLabel}
				onBack={onBack}
			/>
		);
	}
	return (
		<McpServerEditorPage
			key={selection.server.name}
			server={selection.server}
			entry={selection.entry}
			onBack={onBack}
			backLabel={backLabel}
		/>
	);
}
