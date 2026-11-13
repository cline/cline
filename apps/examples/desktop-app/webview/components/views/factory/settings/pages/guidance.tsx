"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { basenamePath } from "@/hooks/use-session-history";
import type {
	FactoryGuidanceRole,
	FactoryGuidanceTarget,
} from "@/lib/factory-settings-client";
import { FS_GUIDANCE } from "@/lib/factory-settings-copy/guidance";
import {
	FS_COUNTS,
	FS_PAGES,
	FS_SHELL,
} from "@/lib/factory-settings-copy/shell";
import { cn } from "@/lib/utils";
import {
	ActionButton,
	PageTitle,
	SettingSelect,
	SettingSkeleton,
	UnavailableNote,
} from "../../factory-settings-rows";
import { toneText } from "../../factory-ui";
import { ProjectSelect } from "../shell-parts";
import type {
	SettingsPageDefinition,
	SettingsPageProps,
	SettingsShell,
} from "../types";
import { useSettingsResource } from "../use-settings-resource";
import { GuidanceHistory } from "./guidance/history";
import {
	GuidanceScopeBlock,
	type RestoreRequest,
} from "./guidance/scope-block";

const G = FS_GUIDANCE;
const ROLES = Object.keys(G.targets) as FactoryGuidanceRole[];
const isRole = (value: string | undefined): value is FactoryGuidanceRole =>
	ROLES.includes(value as FactoryGuidanceRole);

/** Scopes of a target changed outside Factory, waiting for a decision. */
const changedCount = (target: FactoryGuidanceTarget | undefined) =>
	(target?.user.status === "changed" ? 1 : 0) +
	(target?.repository?.status === "changed" ? 1 : 0);

/** The target list's note: "1 changed", the length of yours, or "None". */
function targetState(target: FactoryGuidanceTarget | undefined): {
	text: string;
	changed: boolean;
} {
	const changed = changedCount(target);
	if (changed) return { text: G.changedCount(changed), changed: true };
	if (!target || target.user.status === "none")
		return {
			text: target?.role === "manager" ? G.builtIn : G.none,
			changed: false,
		};
	return { text: G.chars(target.user.content.length), changed: false };
}

/**
 * Guidance: what each role is told on every card. A target list (a select
 * when folded), then the selected target's "Yours" and repository text, each
 * with Edit (diff, then Save), Change with Ask Factory and, for a file
 * changed outside Factory, Accept / Discard; then its history.
 */
function GuidancePage({ shell, headingId, focus }: SettingsPageProps) {
	const project = shell.project;
	const guidance = useSettingsResource(
		() => shell.client.getGuidance(project),
		[project],
	);
	const data = guidance.data;
	const [picked, setPicked] = useState<FactoryGuidanceRole | undefined>(() =>
		isRole(focus?.role) ? focus.role : undefined,
	);
	const role: FactoryGuidanceRole =
		picked ??
		data?.targets.find((target) => changedCount(target) > 0)?.role ??
		"manager";
	// The first read picks the target; it then stays put while its
	// changes are accepted or discarded.
	useEffect(() => {
		if (data && !picked) setPicked(role);
	}, [data, picked, role]);
	const target = data?.targets.find((item) => item.role === role);
	const [historyVersion, setHistoryVersion] = useState(0);
	const [restore, setRestore] = useState<RestoreRequest>();
	const nonce = useRef(0);
	const disabled = shell.readOnly;

	const onTarget = (next: FactoryGuidanceTarget) => {
		if (!data) return;
		const before = data.targets.find((item) => item.role === next.role);
		guidance.set({
			...data,
			targets: data.targets.map((item) =>
				item.role === next.role
					? {
							...item,
							...next,
							repository: next.repository ?? item.repository,
						}
					: item,
			),
		});
		setHistoryVersion((value) => value + 1);
		if (
			changedCount(before) !==
			changedCount({ ...before, ...next } as FactoryGuidanceTarget)
		)
			shell.projectsSummary.reload();
	};

	const title = G.targets[role];
	const word = G.targetWord[role];
	const projectName = project ? basenamePath(project) : "";

	let detail: ReactNode;
	if (guidance.status === "unavailable") {
		detail = (
			<UnavailableNote reason={guidance.unavailable}>
				{guidance.unavailable === "hub" ? FS_SHELL.hubTooOld : G.unavailable}
			</UnavailableNote>
		);
	} else if (guidance.status === "error" && !data) {
		detail = (
			<p
				role="alert"
				className="flex items-center gap-2 py-3 text-xs text-destructive"
			>
				{guidance.error}
				<ActionButton onClick={guidance.reload}>{FS_SHELL.retry}</ActionButton>
			</p>
		);
	} else if (!data || !target) {
		detail = (
			<div className="space-y-3 py-3" aria-busy>
				<SettingSkeleton className="h-24 w-full" />
				<SettingSkeleton className="h-24 w-full" />
			</div>
		);
	} else {
		const max = data.maxChars;
		const repository = role === "manager" ? undefined : target.repository;
		detail = (
			<div
				id="guidance-detail"
				role="tabpanel"
				aria-labelledby={
					shell.folded ? "guidance-target-title" : `guidance-target-${role}`
				}
				className="min-w-0 flex-1"
			>
				<GuidanceScopeBlock
					key={`user-${role}`}
					id="guidance-user"
					role={role}
					scope="user"
					title={title}
					label={G.yours}
					meta={
						target.user.status === "none"
							? role === "manager"
								? G.yoursBuiltIn
								: G.yoursEmpty
							: G.yoursMeta(target.user.content.length, max)
					}
					state={target.user}
					maxChars={max}
					fallback={role === "manager" ? data.managerReadmeDefault : undefined}
					editable={data.userScope}
					disabled={disabled}
					client={shell.client}
					restore={restore}
					onTarget={onTarget}
					onReload={guidance.reload}
					onAsk={() => shell.askFactory(G.draft(word))}
					onSaved={shell.saved}
				/>
				{!data.userScope ? (
					<p className="-mt-3 mb-5 text-xs text-muted-foreground">
						{G.noUserScope}
					</p>
				) : null}
				{role === "manager" ? null : repository && project ? (
					<GuidanceScopeBlock
						key={`repository-${role}-${project}`}
						id="guidance-repository"
						role={role}
						scope="repository"
						workspaceRoot={project}
						title={title}
						label={G.repository}
						heading={
							<>
								<span className="shrink-0">
									{shell.projects.length > 1 ? (
										<ProjectSelect shell={shell} />
									) : (
										<span className="text-xs">{projectName}</span>
									)}
								</span>
								{repository.path ? (
									<span
										className="min-w-0 truncate text-xs text-muted-foreground @max-[720px]/settings:hidden"
										title={repository.path}
									>
										{repository.path}
									</span>
								) : null}
							</>
						}
						meta=""
						state={repository}
						maxChars={max}
						editable
						disabled={disabled}
						client={shell.client}
						restore={restore}
						onTarget={onTarget}
						onReload={guidance.reload}
						onAsk={() => shell.askFactory(G.draftRepository(word, projectName))}
						onSaved={shell.saved}
					/>
				) : (
					<p className="mb-5 rounded-lg border px-3.5 py-3 text-xs text-muted-foreground">
						<span className="mr-2 font-semibold text-foreground">
							{G.repository}
						</span>
						{G.noProject}
					</p>
				)}
				<GuidanceHistory
					onOpenCard={shell.openCard}
					role={role}
					title={title}
					workspaceRoot={role === "manager" ? undefined : project}
					client={shell.client}
					version={historyVersion}
					disabled={disabled}
					onRestore={(entry) => {
						nonce.current += 1;
						setRestore({
							scope: entry.scope,
							text: entry.before,
							note: G.restoreNote(entry.note),
							nonce: nonce.current,
						});
					}}
				/>
			</div>
		);
	}

	const choose = (next: FactoryGuidanceRole) => {
		setPicked(next);
		setRestore(undefined);
	};

	return (
		<>
			<PageTitle id={headingId} title={FS_PAGES.guidance} scope={G.scope} />
			{guidance.status === "unavailable" ? (
				detail
			) : shell.folded ? (
				<div className="mt-3 space-y-3">
					<div data-setting="guidance-targets">
						<span id="guidance-target-title" className="sr-only">
							{G.targetsLabel}
						</span>
						<SettingSelect<FactoryGuidanceRole>
							id="guidance-target"
							className="min-w-[176px]"
							value={role}
							options={ROLES.map((item) => {
								const state = targetState(
									data?.targets.find((t) => t.role === item),
								);
								return {
									value: item,
									label: G.targetSummary(G.targets[item], state.text),
								};
							})}
							onChange={choose}
						/>
					</div>
					{detail}
				</div>
			) : (
				<div className="mt-3 flex items-start gap-5">
					<div
						data-setting="guidance-targets"
						role="tablist"
						aria-orientation="vertical"
						aria-label={G.targetsLabel}
						className="w-[172px] shrink-0 space-y-0.5"
						onKeyDown={(event) => {
							const step =
								event.key === "ArrowDown"
									? 1
									: event.key === "ArrowUp"
										? -1
										: 0;
							if (!step) return;
							event.preventDefault();
							const next =
								ROLES[
									(ROLES.indexOf(role) + step + ROLES.length) % ROLES.length
								];
							choose(next);
							(
								event.currentTarget.querySelector(
									`#guidance-target-${next}`,
								) as HTMLElement | null
							)?.focus();
						}}
					>
						{ROLES.map((item) => {
							const state = targetState(
								data?.targets.find((t) => t.role === item),
							);
							const selected = item === role;
							return (
								<button
									key={item}
									id={`guidance-target-${item}`}
									type="button"
									role="tab"
									aria-selected={selected}
									aria-controls="guidance-detail"
									tabIndex={selected ? 0 : -1}
									onClick={() => choose(item)}
									className={cn(
										"flex h-[30px] w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										selected
											? "bg-muted font-medium text-foreground"
											: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
									)}
								>
									<span className="truncate">{G.targets[item]}</span>
									<span
										className={cn(
											"shrink-0 text-[11px] tabular-nums",
											state.changed
												? toneText("attention")
												: "text-muted-foreground",
										)}
									>
										{data ? state.text : ""}
									</span>
								</button>
							);
						})}
					</div>
					{detail}
				</div>
			)}
		</>
	);
}

/** Files changed outside Factory: yours, then each project's. */
function useBadge(shell: SettingsShell) {
	const summary = shell.projectsSummary.data;
	if (!summary) return 0;
	return (
		summary.userGuidanceChanged.length +
		summary.projects.reduce(
			(sum, project) => sum + project.guidance.changed.length,
			0,
		)
	);
}

export const settingsPage: SettingsPageDefinition = {
	Page: GuidancePage,
	search: [
		{
			row: "guidance-targets",
			title: G.searchTargets,
			description: Object.values(G.targets).join(", "),
		},
		{ row: "guidance-user", title: G.searchYours, description: G.scope },
		{
			row: "guidance-repository",
			title: G.searchRepository,
			description: G.scope,
		},
	],
	useBadge,
	badgeLabel: FS_COUNTS.guidance,
	wide: true,
};
