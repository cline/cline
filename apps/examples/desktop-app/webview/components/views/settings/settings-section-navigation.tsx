"use client";

import {
	Blocks,
	Bug,
	CircleUserRound,
	Clock3,
	Cpu,
	Import,
	Info,
	Keyboard,
	Mic,
	Network,
	Plug,
	Radio,
	type Settings,
	SlidersHorizontal,
	Store,
} from "lucide-react";
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { useHasConnectedProvider } from "@/hooks/use-has-connected-provider";
import { useHostCapabilities } from "@/lib/host-mode";
import { cn } from "@/lib/utils";
import {
	CUSTOMIZATION_SECTION_LABELS,
	CUSTOMIZATION_SECTIONS,
	isProviderSection,
	PROVIDER_SECTION_LABELS,
	PROVIDER_SECTIONS,
	readProviderSectionInUse,
	type SettingsSection,
	settingsSectionsForHost,
} from "./sections";

/*
 * Settings section list shown in the app sidebar while Settings is open.
 * Lives outside agent-sidebar.tsx so hosts without the app sidebar (VS Code)
 * can render the same navigation next to the settings page.
 */

const SETTINGS_SECTION_ICONS = {
	General: SlidersHorizontal,
	Providers: Plug,
	"Local Models": Cpu,
	Voice: Mic,
	Keybindings: Keyboard,
	Channels: Radio,
	Schedules: Clock3,
	Import: Import,
	Remote: Network,
	Account: CircleUserRound,
	Debug: Bug,
	About: Info,
	Customize: Blocks,
	Marketplace: Store,
} satisfies Record<SettingsSection, typeof Settings>;

// The Customize section is the installed inventory, so its nav row reads
// "Installed" (it sits under a "Customize" group header / next to the
// Marketplace row, which supplies the context).
function navLabel(section: SettingsSection): string {
	return (
		CUSTOMIZATION_SECTION_LABELS[
			section as keyof typeof CUSTOMIZATION_SECTION_LABELS
		] ?? section
	);
}

export function SettingsSectionNavigation({
	activeSection,
	collapsed,
	onSelect,
	includeActionSections = false,
}: {
	activeSection: SettingsSection;
	collapsed: boolean;
	onSelect: (section: SettingsSection) => void;
	/**
	 * List Schedules and the Customize group here too. The app sidebar
	 * has its own rows for them; hosts without it (VS Code) set this so
	 * every section is reachable from this list.
	 */
	includeActionSections?: boolean;
}) {
	// Voice input only works with a connected model provider, so its section
	// stays disabled until one is set up (null = catalog still loading).
	const hasConnectedProvider = useHasConnectedProvider();
	const host = useHostCapabilities();
	const renderSectionButton = (section: SettingsSection) => {
		const Icon = SETTINGS_SECTION_ICONS[section];
		const label = navLabel(section);
		const disabled = section === "Voice" && hasConnectedProvider === false;
		const button = (
			<Button
				aria-current={activeSection === section ? "page" : undefined}
				aria-label={label}
				className={cn(
					"min-w-0 justify-start",
					activeSection === section &&
						"bg-surface-hover text-sidebar-foreground",
					collapsed && "size-9 justify-center px-0",
					disabled && !collapsed && "w-full",
				)}
				disabled={disabled}
				key={disabled ? undefined : section}
				onClick={() => onSelect(section)}
				title={label}
				type="button"
				variant="sidebarItem"
			>
				<Icon className="size-4 shrink-0" />
				{!collapsed ? <span className="truncate">{label}</span> : null}
			</Button>
		);
		if (!disabled) {
			return button;
		}
		// Disabled buttons swallow pointer events, so the explanation lives on
		// a wrapping span for the native tooltip to work.
		return (
			<span
				className={cn("block", collapsed && "flex w-full justify-start")}
				key={section}
				title="Configure a model provider to set up voice input"
			>
				{button}
			</span>
		);
	};

	const renderProvidersGroup = () => {
		const open = isProviderSection(activeSection);
		return (
			<Fragment key="providers">
				<Button
					aria-label="Provider"
					className={cn(
						"min-w-0 justify-start",
						open && "bg-surface-hover-lighter text-sidebar-foreground",
					)}
					onClick={() => onSelect(readProviderSectionInUse())}
					title="Provider"
					type="button"
					variant="sidebarItem"
				>
					<Plug className="size-4 shrink-0" />
					<span className="truncate">Provider</span>
				</Button>
				{open
					? PROVIDER_SECTIONS.map((section) => (
							<Button
								aria-current={activeSection === section ? "page" : undefined}
								aria-label={PROVIDER_SECTION_LABELS[section]}
								className={cn(
									"min-w-0 justify-start pl-8!",
									activeSection === section &&
										"bg-surface-hover text-sidebar-foreground",
								)}
								key={section}
								onClick={() => onSelect(section)}
								title={PROVIDER_SECTION_LABELS[section]}
								type="button"
								variant="sidebarItem"
							>
								<span className="truncate">
									{PROVIDER_SECTION_LABELS[section]}
								</span>
							</Button>
						))
					: null}
			</Fragment>
		);
	};

	return (
		<nav
			aria-label="Settings sections"
			className={cn(
				"flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden",
				collapsed ? "w-full items-start" : "w-full",
			)}
		>
			{!collapsed ? (
				<p className="px-2 pb-2 text-sm font-medium text-muted-foreground">
					Settings
				</p>
			) : null}
			{/* Schedules and Customize already have dedicated rows at the top of
			    the expanded sidebar (Customize's Installed/Marketplace sub-tabs
			    render under that row), so the section nav skips them there.
			    The collapsed sidebar has no action rows and keeps them
			    reachable. */}
			{settingsSectionsForHost(host)
				.filter(
					(section) =>
						collapsed || includeActionSections || section !== "Schedules",
				)
				.map((section) => {
					if (collapsed || !isProviderSection(section)) {
						return renderSectionButton(section);
					}
					return section === "Account" ? renderProvidersGroup() : null;
				})}
			{collapsed ? (
				<>
					<div className="my-2 h-px w-6 shrink-0 bg-sidebar-border" />
					{CUSTOMIZATION_SECTIONS.map(renderSectionButton)}
				</>
			) : includeActionSections ? (
				<>
					<p className="px-2 pb-2 pt-4 text-sm font-medium text-muted-foreground">
						Customize
					</p>
					{CUSTOMIZATION_SECTIONS.map(renderSectionButton)}
				</>
			) : null}
		</nav>
	);
}
