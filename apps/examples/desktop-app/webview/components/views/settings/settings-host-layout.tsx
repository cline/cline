"use client";

import { ArrowLeft } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SettingsSection } from "./sections";
import { SettingsSectionNavigation } from "./settings-section-navigation";

// Below this the webview is a side panel: the full labelled list would take
// most of the width, so it collapses to the icon rail the desktop sidebar
// uses when collapsed.
const LABELLED_NAV_QUERY = "(min-width: 640px)";

function subscribe(onChange: () => void): () => void {
	const query = window.matchMedia(LABELLED_NAV_QUERY);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

function useLabelledNav(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(LABELLED_NAV_QUERY).matches,
		() => true,
	);
}

/**
 * Settings for hosts without the app sidebar (VS Code). Renders the same
 * section navigation the desktop sidebar shows while Settings is open, as
 * a left column next to the page, plus a way back to the conversation.
 */
export function SettingsHostLayout({
	section,
	onSelect,
	onBack,
	children,
}: {
	section: SettingsSection;
	onSelect: (section: SettingsSection) => void;
	onBack: () => void;
	children: ReactNode;
}) {
	const labelled = useLabelledNav();
	return (
		<div className="flex h-full min-h-0" data-slot="settings-host-layout">
			<aside
				className={cn(
					"flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
					labelled ? "w-56 px-3" : "w-12 items-center px-1.5",
				)}
			>
				<Button
					aria-label="Back to conversation"
					className={cn(
						"mt-3 mb-4 shrink-0",
						!labelled && "size-9 justify-center px-0",
					)}
					onClick={onBack}
					title="Back to conversation"
					type="button"
					variant="sidebarItem"
				>
					<ArrowLeft className="size-4 shrink-0" />
					{labelled ? <span className="truncate">Back</span> : null}
				</Button>
				<div className="min-h-0 w-full flex-1 pb-3">
					<SettingsSectionNavigation
						activeSection={section}
						collapsed={!labelled}
						includeActionSections
						onSelect={onSelect}
					/>
				</div>
			</aside>
			<div className="min-h-0 min-w-0 flex-1">{children}</div>
		</div>
	);
}
