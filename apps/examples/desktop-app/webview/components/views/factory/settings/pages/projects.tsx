"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { basenamePath } from "@/hooks/use-session-history";
import { isTauriAvailable } from "@/lib/desktop-client";
import { factorySettingsErrorMessage } from "@/lib/factory-settings-client";
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
 * "Add project…" adds one from the app's folder dialog (or a typed path
 * where there is none).
 */
function ProjectsPage({ shell, headingId, focus }: SettingsPageProps) {
	const summary = shell.projectsSummary;
	// Projects are added elsewhere too (the manager chat, another window):
	// opening the page reads them again, unless a read is under way. The
	// list read before stays up meanwhile.
	const reloadOnOpen = useRef(summary.status !== "loading");
	useEffect(() => {
		if (reloadOnOpen.current) summary.reload();
	}, [summary.reload]);
	const reading = summary.status === "loading" && !summary.data;
	// Projects added here show at once, by path, until the summary has them.
	const [added, setAdded] = useState<string[]>([]);
	// The summary when it can be read; otherwise the shell's own list, by path.
	const listed: ProjectEntry[] = summary.data
		? summary.data.projects.map((project) => ({
				workspaceRoot: project.workspaceRoot,
				name: project.name,
				summary: project,
			}))
		: shell.projects.map((root) => ({
				workspaceRoot: root,
				name: basenamePath(root),
			}));
	const entries: ProjectEntry[] = [
		...listed,
		...added
			.filter((root) => !listed.some((entry) => entry.workspaceRoot === root))
			.map((root) => ({ workspaceRoot: root, name: basenamePath(root) })),
	];
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

	// Adding: the folder dialog, else a typed path; the added (or already
	// known) project's row then takes focus.
	const [adding, setAdding] = useState(false);
	const [typedPath, setTypedPath] = useState<string>();
	const [addProblem, setAddProblem] = useState<string>();
	const [focusRoot, setFocusRoot] = useState<string>();
	const add = async (folder: string) => {
		setAdding(true);
		setAddProblem(undefined);
		try {
			const { workspaceRoot } = await shell.client.addProject(folder);
			setTypedPath(undefined);
			setAdded((current) =>
				current.includes(workspaceRoot) ? current : [...current, workspaceRoot],
			);
			setFocusRoot(workspaceRoot);
			summary.reload();
		} catch (cause) {
			setAddProblem(factorySettingsErrorMessage(cause, P.addFailed));
		} finally {
			setAdding(false);
		}
	};
	const chooseFolder = async () => {
		setAddProblem(undefined);
		// Outside the app's own window (the UI in a browser) no dialog can
		// open here: the path field is the way to add.
		if (!isTauriAvailable()) {
			setTypedPath((current) => current ?? "");
			return;
		}
		let picked: string | null;
		try {
			picked = await shell.client.pickFolder();
		} catch {
			setAddProblem(P.pickerFailed);
			setTypedPath("");
			return;
		}
		if (picked?.trim()) await add(picked.trim());
	};
	useEffect(() => {
		const entry = entries.find((item) => item.workspaceRoot === focusRoot);
		if (!entry) return;
		listRef.current
			?.querySelector<HTMLElement>(`[data-setting="${rowId(entry)}"] button`)
			?.focus();
		setFocusRoot(undefined);
	});
	const addButton = (
		<ActionButton
			primary
			disabled={adding || shell.readOnly}
			onClick={() => void chooseFolder()}
		>
			{P.add}
		</ActionButton>
	);
	const addForm =
		typedPath !== undefined || addProblem ? (
			<div className="mt-3 flex flex-col gap-2">
				{addProblem ? (
					<p role="alert" className="text-xs text-destructive">
						{addProblem}
					</p>
				) : null}
				{typedPath !== undefined ? (
					<div className="flex items-center gap-2">
						<Input
							autoFocus
							aria-label={P.pathLabel}
							placeholder={P.pathPlaceholder}
							value={typedPath}
							onChange={(event) => setTypedPath(event.target.value)}
							onKeyDown={(event) => {
								if (event.key !== "Enter" || adding || !typedPath.trim())
									return;
								event.preventDefault();
								void add(typedPath.trim());
							}}
							className="h-[26px] flex-1 text-xs"
						/>
						<ActionButton
							disabled={adding || !typedPath.trim()}
							onClick={() => void add(typedPath.trim())}
						>
							{P.pathAdd}
						</ActionButton>
					</div>
				) : null}
			</div>
		) : null;

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
			<PageTitle
				id={headingId}
				title={FS_PAGES.projects}
				scope={P.scope}
				action={!reading && entries.length > 0 ? addButton : undefined}
			/>
			{addForm}
			{reading ? (
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
					{addButton}
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
