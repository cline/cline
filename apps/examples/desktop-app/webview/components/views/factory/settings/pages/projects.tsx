"use client";

import { useEffect, useRef, useState } from "react";
import { basenamePath } from "@/hooks/use-session-history";
import { FS_PROJECTS } from "@/lib/factory-settings-copy/projects";
import { FS_PAGES, FS_SHELL } from "@/lib/factory-settings-copy/shell";
import {
	ActionButton,
	GroupHeading,
	OpenRow,
	PageTitle,
	SettingSkeleton,
	tildePath,
	UnavailableNote,
} from "../../factory-settings-rows";
import type { SettingsPageDefinition, SettingsPageProps } from "../types";
import { ProjectDetail, type ProjectEntry } from "./projects/detail";
import { locationLine, statusLine, worstStatus } from "./projects/summary";

const P = FS_PROJECTS;

const rowId = (project: ProjectEntry) => `project-${project.name}`;

/**
 * Projects: the repositories Factory knows, each with its state in one line
 * and its worst status as a pill; a row opens that project's detail here.
 */
function ProjectsPage({ shell, headingId, focus }: SettingsPageProps) {
	const summary = shell.projectsSummary;
	// The summary when it can be read; otherwise the shell's own list, by path.
	const entries: ProjectEntry[] =
		summary.status === "ready" && summary.data
			? summary.data.projects.map((project) => ({
					workspaceRoot: project.workspaceRoot,
					name: project.name,
					summary: project,
				}))
			: shell.projects.map((root) => ({
					workspaceRoot: root,
					name: basenamePath(root),
				}));
	const [selected, setSelected] = useState<string | undefined>(focus?.project);
	useEffect(() => {
		if (focus?.project) setSelected(focus.project);
	}, [focus?.project]);
	// Back to the list puts focus on the row that was open.
	const returnTo = useRef<string>(undefined);
	const listRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (selected || !returnTo.current) return;
		listRef.current
			?.querySelector<HTMLElement>(
				`[data-setting="${returnTo.current}"] button`,
			)
			?.focus();
		returnTo.current = undefined;
	}, [selected]);

	const project = entries.find((entry) => entry.workspaceRoot === selected);
	if (project)
		return (
			<ProjectDetail
				shell={shell}
				headingId={headingId}
				project={project}
				onBack={() => {
					returnTo.current = rowId(project);
					setSelected(undefined);
				}}
			/>
		);

	return (
		<div ref={listRef}>
			<PageTitle id={headingId} title={FS_PAGES.projects} scope={P.scope} />
			{summary.status === "loading" ? (
				<div aria-hidden>
					{[0, 1, 2].map((index) => (
						<div
							key={index}
							className="flex items-center justify-between border-b py-4"
						>
							<SettingSkeleton className="w-56" />
							<SettingSkeleton />
						</div>
					))}
				</div>
			) : entries.length === 0 ? (
				<div
					data-setting="projectsList"
					className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-4"
				>
					<p className="min-w-[200px] flex-1 text-xs text-muted-foreground">
						{P.empty}
					</p>
					<ActionButton primary onClick={shell.newWork}>
						{P.emptyAction}
					</ActionButton>
				</div>
			) : (
				<>
					<GroupHeading>{P.count(entries.length)}</GroupHeading>
					{summary.status === "unavailable" ? (
						<UnavailableNote reason={summary.unavailable}>
							{summary.unavailable === "hub" ? P.summaryUnavailable : undefined}
						</UnavailableNote>
					) : summary.status === "error" ? (
						<p
							role="alert"
							className="flex items-center gap-2 border-b py-3 text-xs text-destructive"
						>
							<span className="flex-1">{summary.error}</span>
							<ActionButton onClick={summary.reload}>
								{FS_SHELL.retry}
							</ActionButton>
						</p>
					) : null}
					<div data-setting="projectsList">
						{entries.map((entry) => (
							<OpenRow
								key={entry.workspaceRoot}
								id={rowId(entry)}
								title={entry.name}
								description={
									entry.summary ? (
										<>
											<span className="block">
												{locationLine(entry.summary)}
											</span>
											<span className="block">{statusLine(entry.summary)}</span>
										</>
									) : (
										tildePath(entry.workspaceRoot)
									)
								}
								pill={entry.summary ? worstStatus(entry.summary) : undefined}
								onOpen={() => setSelected(entry.workspaceRoot)}
							/>
						))}
					</div>
				</>
			)}
		</div>
	);
}

export const settingsPage: SettingsPageDefinition = {
	Page: ProjectsPage,
	search: [
		{ row: "projectsList", title: FS_PAGES.projects, description: P.search },
	],
};
