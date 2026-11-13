import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { useFactoryLimits } from "@/hooks/use-factory-limits";
import type {
	FactoryProjects,
	FactorySettingsClient,
} from "@/lib/factory-settings-client";
import type { FS_GROUPS } from "@/lib/factory-settings-copy/shell";
import type { DefaultWorkflow } from "./default-workflow";
import type { SettingsResource } from "./use-settings-resource";

export type SettingsPageId =
	| "automation"
	| "limits"
	| "roles"
	| "guidance"
	| "stages"
	| "verification"
	| "projects"
	| "computer"
	| "connections"
	| "workflows"
	| "data";

export type SettingsGroupId = keyof typeof FS_GROUPS;

/** Where a link into settings lands: a page, and optionally a row in it. */
export type SettingsFocus = {
	page: SettingsPageId;
	/** A row's `data-setting` id: scrolled to and its control focused. */
	row?: string;
	/** Selects this project on project-scoped pages. */
	project?: string;
	/** Roles & models and Guidance: the role to open. */
	role?: string;
};

/** The app's own settings sections Factory settings links out to. */
export type AppSettingsSection =
	| "General"
	| "Providers"
	| "Customize"
	| "Remote"
	| "About";

/** One searchable row: its `data-setting` id and the words it is found by. */
export type SettingsSearchEntry = {
	row: string;
	title: string;
	description?: string;
};

/** Everything a page gets from the shell. */
export type SettingsShell = {
	/** The default workflow: `config`, `commit(next, row)`, `errorFor(row)`… */
	workflow: DefaultWorkflow;
	/** The Hub's limits (work at once, paused, daily limit). */
	limits: ReturnType<typeof useFactoryLimits>;
	/** Every settings command; see `lib/factory-settings-client.ts`. */
	client: FactorySettingsClient;
	/**
	 * Project checkouts with Factory work (workspace roots): the board's, and
	 * any other `factory_get_projects` lists.
	 */
	projects: readonly string[];
	/** The project shared by the project-scoped pages; undefined with none. */
	project: string | undefined;
	setProject: (workspaceRoot: string) => void;
	/** `factory_get_projects`, read once for the list and the nav counts. */
	projectsSummary: SettingsResource<FactoryProjects>;
	/** Opens a page (and a row, project or role in it). */
	open: (focus: SettingsFocus) => void;
	/** Opens the docked Ask Factory panel; a draft goes in its composer, unsent. */
	askFactory: (draft?: string) => void;
	/** Opens a section of the app's own Settings. */
	openAppSettings: (section: AppSettingsSection) => void;
	/** Leaves settings and opens a card's page. */
	openCard: (taskId: string) => void;
	/** Back to the board showing archived cards. */
	openArchive: () => void;
	/** Back to the board with the New work composer focused. */
	newWork: () => void;
	/** Shows "Saved" in the header for 2 seconds. */
	saved: () => void;
	/** The Hub can't be reached: show values, disable every control. */
	readOnly: boolean;
	/** The settings area is under 720px: the section list is a page menu. */
	folded: boolean;
};

export type SettingsPageProps = {
	shell: SettingsShell;
	/** The `h2` id the page's `section` is labelled by. */
	headingId: string;
	/** The deep link that opened this page, if any. */
	focus?: Omit<SettingsFocus, "page">;
};

/** What each page file exports as `settingsPage`. */
export type SettingsPageDefinition = {
	Page: ComponentType<SettingsPageProps>;
	/** Rows the settings search finds on this page. */
	search: readonly SettingsSearchEntry[];
	/**
	 * The section list's count (things waiting for a decision), as a hook the
	 * shell calls on every render, whatever page is open. 0 hides the pill.
	 */
	useBadge?: (shell: SettingsShell) => number;
	/** The badge's sentence for screen readers. */
	badgeLabel?: (count: number) => string;
	/** Content column 940px instead of 760px (Guidance). */
	wide?: boolean;
};

export type SettingsPageEntry = SettingsPageDefinition & {
	id: SettingsPageId;
	group: SettingsGroupId;
	title: string;
	/** The section list's leading icon for this page. */
	icon: LucideIcon;
};
