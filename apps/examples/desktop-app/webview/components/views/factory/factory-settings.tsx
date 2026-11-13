"use client";

import { ArrowLeft, Check, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFactoryLimits } from "@/hooks/use-factory-limits";
import { FACTORY_MANAGER } from "@/lib/factory-copy";
import { requestFactoryDiscussion } from "@/lib/factory-feedback";
import { factorySettingsClient } from "@/lib/factory-settings-client";
import { FS_SHELL } from "@/lib/factory-settings-copy/shell";
import { cn } from "@/lib/utils";
import { ActionButton, SettingsBanner } from "./factory-settings-rows";
import { toneText } from "./factory-ui";
import { useDefaultWorkflow } from "./settings/default-workflow";
import {
	type SettingsBadges,
	SettingsNav,
	SettingsPageMenu,
} from "./settings/nav";
import { SETTINGS_PAGES, settingsPageId } from "./settings/registry";
import type {
	AppSettingsSection,
	SettingsFocus,
	SettingsShell,
} from "./settings/types";
import { useSettingsResource } from "./settings/use-settings-resource";
import { useElementSize } from "./use-element-size";

export {
	type CommitWorkflow,
	type DefaultWorkflow,
	effectiveDraftReview,
	updateOlderWorkflow,
} from "./settings/default-workflow";
export type { SettingsFocus } from "./settings/types";

/** The open page, kept beside the Factory destination for the session. */
export const FACTORY_SETTINGS_SECTION_KEY = "factory.settingsSection";
/** The project shared by the project-scoped pages, for the session. */
export const FACTORY_SETTINGS_PROJECT_KEY = "factory.settingsProject";
/** Below this settings-area width the section list folds into a page menu. */
const SECTION_LIST_MIN_WIDTH = 720;
const SAVED_MS = 2000;

function sessionValue(key: string): string | null {
	return typeof window === "undefined" ? null : sessionStorage.getItem(key);
}

/** The spending banner's old link ("dailyCostUsd") or a full deep link. */
function initialFocus(
	focus: "dailyCostUsd" | SettingsFocus | undefined,
): SettingsFocus {
	if (focus === "dailyCostUsd") return { page: "limits", row: "dailyCostUsd" };
	if (focus) return focus;
	return {
		page:
			settingsPageId(sessionValue(FACTORY_SETTINGS_SECTION_KEY)) ??
			"automation",
	};
}

/** Selectors for a row's first control, in the order a person would use. */
const CONTROL =
	'[data-setting-control], select, input, textarea, button, [role="switch"], [tabindex]';

/**
 * Factory settings: a sibling of the board in the same app shell. One header
 * row with the only way back, a grouped section list (a page menu in the
 * header when the area is narrow) and one page of rows that save as they
 * change. Pages come from `settings/registry.ts`, one file each.
 */
export function FactorySettingsPage({
	onBack,
	onAskFactory,
	askFactoryOpen = false,
	projects,
	limits: limitsProp,
	focus,
	onOpenAppSettings,
	onOpenArchive,
	onOpenCard,
	onNewWork,
}: {
	onBack: () => void;
	/** Opens or closes the docked Ask Factory panel. */
	onAskFactory?: () => void;
	askFactoryOpen?: boolean;
	/** Project checkouts with Factory work. */
	projects: readonly string[];
	/** The board's Hub limits, so both show one state; read here when absent. */
	limits?: ReturnType<typeof useFactoryLimits>;
	/** Where to open: a page and row, or the spending banner's daily limit. */
	focus?: "dailyCostUsd" | SettingsFocus;
	onOpenAppSettings?: (section: AppSettingsSection) => void;
	/** Back to the board showing archived cards. */
	onOpenArchive?: () => void;
	/** Leaves settings and opens a card's page. */
	onOpenCard?: (taskId: string) => void;
	/** Back to the board with New work focused. */
	onNewWork?: () => void;
}) {
	const [location, setLocation] = useState(() => ({
		...initialFocus(focus),
		seq: 0,
	}));
	const page = location.page;
	useEffect(() => {
		sessionStorage.setItem(FACTORY_SETTINGS_SECTION_KEY, page);
	}, [page]);

	const [savedAt, setSavedAt] = useState(0);
	const saved = useCallback(() => setSavedAt(Date.now()), []);
	useEffect(() => {
		if (!savedAt) return;
		const timer = setTimeout(() => setSavedAt(0), SAVED_MS);
		return () => clearTimeout(timer);
	}, [savedAt]);

	const ownLimits = useFactoryLimits({ enabled: !limitsProp });
	const limits = limitsProp ?? ownLimits;
	// A Hub limit saved: the hook rolls back and reports a failure itself.
	const limitsSaving = useRef(false);
	useEffect(() => {
		if (limitsSaving.current && !limits.saving && !limits.error) saved();
		limitsSaving.current = limits.saving;
	}, [limits.saving, limits.error, saved]);
	const workflow = useDefaultWorkflow(saved);

	const [setRoot, { width }] = useElementSize();
	// 0 is "not measured" (jsdom, first paint): the wide layout.
	const folded = width > 0 && width < SECTION_LIST_MIN_WIDTH;

	const projectsSummary = useSettingsResource(
		() => factorySettingsClient.getProjects(),
		[projects.join("\0")],
	);
	const hub = useSettingsResource(
		() => factorySettingsClient.getProcessContext(),
		[],
	);
	const readOnly = hub.data?.hub?.status === "disconnected";

	// Projects with cards on the board, and any other `factory_get_projects`
	// knows (approvals or a test setup but no open card), so a deep link to
	// any of them selects it.
	const knownProjects = useMemo(
		() => [
			...new Set([
				...projects,
				...(projectsSummary.data?.projects ?? []).map(
					(item) => item.workspaceRoot,
				),
			]),
		],
		[projects, projectsSummary.data],
	);
	// The person's pick, else the first project with something awaiting a
	// decision, else the first.
	const [pickedProject, setPickedProject] = useState(
		() =>
			(focus && focus !== "dailyCostUsd" ? focus.project : undefined) ??
			sessionValue(FACTORY_SETTINGS_PROJECT_KEY) ??
			undefined,
	);
	const project =
		pickedProject && knownProjects.includes(pickedProject)
			? pickedProject
			: (projectsSummary.data?.projects.find(
					(item) =>
						item.stages.awaiting > 0 ||
						item.verification === "proposed" ||
						item.verification === "changed",
				)?.workspaceRoot ?? knownProjects[0]);
	const setProject = useCallback((root: string) => {
		setPickedProject(root);
		sessionStorage.setItem(FACTORY_SETTINGS_PROJECT_KEY, root);
	}, []);

	const open = useCallback(
		(next: SettingsFocus) => {
			if (next.project) setProject(next.project);
			setLocation((current) => ({ ...next, seq: current.seq + 1 }));
		},
		[setProject],
	);
	const askFactory = useCallback(
		(draft?: string) => {
			if (draft) requestFactoryDiscussion({ draft });
			else onAskFactory?.();
		},
		[onAskFactory],
	);

	const shell: SettingsShell = {
		workflow,
		limits,
		client: factorySettingsClient,
		projects: knownProjects,
		project,
		setProject,
		projectsSummary,
		open,
		askFactory,
		openAppSettings: (section) => onOpenAppSettings?.(section),
		openArchive: () => onOpenArchive?.(),
		openCard: (taskId) => onOpenCard?.(taskId),
		newWork: () => (onNewWork ?? onBack)(),
		saved,
		readOnly,
		folded,
	};

	// Every page's count, from its own hook; the registry is fixed, so the
	// hooks run in the same order on every render.
	const badges: SettingsBadges = {};
	for (const entry of SETTINGS_PAGES) {
		// biome-ignore lint/correctness/useHookAtTopLevel: SETTINGS_PAGES is a fixed list, so these hooks run in the same order every render.
		const count = entry.useBadge?.(shell) ?? 0;
		if (count > 0)
			badges[entry.id] = {
				count,
				label: entry.badgeLabel?.(count) ?? String(count),
			};
	}

	const current =
		SETTINGS_PAGES.find((entry) => entry.id === page) ?? SETTINGS_PAGES[0];
	const headingId = `factory-settings-${current.id}-heading`;

	// A deep link or a search hit: scroll to its row and focus its control
	// once the page has rendered it (rows that load arrive a little later).
	const contentRef = useRef<HTMLElement>(null);
	const { row, seq } = location;
	// biome-ignore lint/correctness/useExhaustiveDependencies: `seq` re-runs the search for a row opened again.
	useEffect(() => {
		if (!row) return;
		let tries = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const find = () => {
			const element = contentRef.current?.querySelector<HTMLElement>(
				`[data-setting="${row}"]`,
			);
			const control = element?.querySelector<HTMLElement>(CONTROL);
			// A control still loading is disabled and can't take focus yet.
			if (element && !(control as HTMLInputElement | null)?.disabled) {
				element.scrollIntoView?.({ block: "center" });
				(control ?? element).focus();
				return;
			}
			if (++tries < 20) timer = setTimeout(find, 100);
		};
		find();
		return () => clearTimeout(timer);
	}, [row, seq]);

	const Page = current.Page;
	const pageFocus = useMemo(
		() => ({
			row: location.row,
			role: location.role,
			project: location.project,
		}),
		[location.row, location.role, location.project],
	);

	const header = (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b pr-3 pl-2.5">
			<Button
				variant="ghost"
				size="sm"
				className="size-7 px-0"
				aria-label={FS_SHELL.back}
				title={FS_SHELL.back}
				onClick={onBack}
			>
				<ArrowLeft aria-hidden className="size-4" />
			</Button>
			<h1 className="truncate text-[15px] font-semibold">{FS_SHELL.title}</h1>
			{folded ? (
				<SettingsPageMenu
					pages={SETTINGS_PAGES}
					current={current.id}
					badges={badges}
					onOpen={open}
				/>
			) : null}
			<span className="flex-1" />
			<output
				aria-live="polite"
				className="flex items-center gap-1 text-xs text-muted-foreground"
			>
				{savedAt ? (
					<>
						<Check
							aria-hidden
							className={cn("size-3.5", toneText("success"))}
						/>
						{FS_SHELL.saved}
					</>
				) : null}
			</output>
			{onAskFactory ? (
				<Button
					size="sm"
					variant={askFactoryOpen ? "secondary" : "default"}
					aria-expanded={askFactoryOpen}
					data-ask-factory=""
					onClick={onAskFactory}
					className={cn("h-7 px-2.5", askFactoryOpen && "border")}
				>
					<MessageSquare aria-hidden className="size-3.5" />
					{FACTORY_MANAGER.ask}
				</Button>
			) : null}
		</header>
	);

	return (
		<div
			ref={setRoot}
			className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
			data-testid="factory-settings"
			data-layout={folded ? "menu" : "list"}
			data-settings-page={current.id}
		>
			{header}
			<div className="flex min-h-0 flex-1">
				{folded ? null : (
					<SettingsNav
						pages={SETTINGS_PAGES}
						current={current.id}
						badges={badges}
						onOpen={open}
					/>
				)}
				<ScrollArea className="min-h-0 min-w-0 flex-1">
					<section
						ref={contentRef}
						id={`factory-settings-${current.id}`}
						aria-labelledby={headingId}
						data-settings-content=""
						className={cn(
							"@container/settings",
							current.wide ? "max-w-[996px]" : "max-w-[816px]",
							folded ? "px-4 pt-4 pb-6" : "px-7 pt-6 pb-8",
						)}
					>
						{readOnly ? (
							<div className="mb-3">
								<SettingsBanner
									tone="danger"
									actions={
										<ActionButton onClick={hub.reload}>
											{FS_SHELL.retry}
										</ActionButton>
									}
								>
									{FS_SHELL.hubUnreachable}
								</SettingsBanner>
							</div>
						) : null}
						<Page
							key={current.id}
							shell={shell}
							headingId={headingId}
							focus={pageFocus}
						/>
					</section>
				</ScrollArea>
			</div>
		</div>
	);
}
