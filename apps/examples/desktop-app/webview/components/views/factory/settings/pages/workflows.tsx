"use client";

import { factoryWorkflowConfigSchema } from "@cline/shared/browser";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { FactoryPreset } from "@/lib/factory-presets";
import { FS_PAGES, FS_SHELL } from "@/lib/factory-settings-copy/shell";
import { FS_WORKFLOWS } from "@/lib/factory-settings-copy/workflows";
import {
	ActionButton,
	ConfirmDialog,
	DisclosureRow,
	GroupHeading,
	PageTitle,
	SettingSkeleton,
	StatusPill,
} from "../../factory-settings-rows";
import { WorkflowLoadError } from "../shell-parts";
import type {
	SettingsPageDefinition,
	SettingsPageProps,
	SettingsShell,
} from "../types";
import { useRowSaves } from "../use-settings-resource";
import {
	DeleteDefaultDialog,
	ImportDialog,
	SaveAsDialog,
} from "./workflows/dialogs";
import {
	copyName,
	isBuiltIn,
	orderedWorkflows,
	workflowJson,
	workflowNameProblem,
	workflowSummary,
} from "./workflows/summary";

const W = FS_WORKFLOWS;

type Saves = ReturnType<typeof useRowSaves>;
/** A result line: under a workflow's row, or under the title (`name: ""`). */
type Notice = { name: string; text: string };

/** A workflow row's `data-setting` id ("workflow-0"): names may hold spaces. */
const rowId = (index: number) => `workflow-${index}`;

/**
 * Workflows: the saved workflows (the default is the one Automation and
 * Roles & models edit), with make default, rename, duplicate, copy as JSON
 * and delete; save the settings in use as a new workflow; import one; and
 * the limits Factory puts on a repository's workflow file.
 */
function WorkflowsPage({ shell, headingId }: SettingsPageProps) {
	const { workflow } = shell;
	const { presets, setPresets, setDefaultPreset, loading } = workflow.presets;
	const saves = useRowSaves(shell.saved);
	const [notice, setNotice] = useState<Notice>();
	const [dialog, setDialog] = useState<"import" | "saveAs">();
	// A renamed row mounts again under its new name: its menu button gets focus.
	const [focusMenu, setFocusMenu] = useState<string>();
	const disabled = loading || shell.readOnly || saves.busy !== undefined;
	const ordered = orderedWorkflows(presets);

	const apply = (items: FactoryPreset[], nextDefault?: string) => {
		setPresets(items);
		if (nextDefault) setDefaultPreset(nextDefault);
	};

	const saveAs = async (name: string, asDefault: boolean) => {
		const result = await saves.save("saveAs", () =>
			shell.client.savePreset({
				name,
				config: factoryWorkflowConfigSchema.parse(workflow.config),
				...(asDefault ? { useByDefault: true } : {}),
			}),
		);
		if (!result.ok) return;
		apply(result.value, asDefault ? name : undefined);
		setDialog(undefined);
		setNotice({ name: "", text: W.savedAs(name) });
	};

	return (
		<>
			<PageTitle
				id={headingId}
				title={FS_PAGES.workflows}
				scope={W.scope}
				action={
					<div className="flex gap-2">
						<span data-setting="importWorkflow">
							<ActionButton
								disabled={disabled}
								onClick={() => setDialog("import")}
							>
								{W.import}
							</ActionButton>
						</span>
						<span data-setting="saveWorkflowAs">
							<ActionButton
								disabled={disabled}
								onClick={() => setDialog("saveAs")}
							>
								{W.saveAs}
							</ActionButton>
						</span>
					</div>
				}
				alert={
					<>
						<WorkflowLoadError workflow={workflow} />
						{notice?.name === "" ? (
							<output className="mt-2 block text-xs text-muted-foreground">
								{notice.text}
							</output>
						) : null}
					</>
				}
			/>
			<GroupHeading>{W.savedGroup}</GroupHeading>
			{loading && presets.length === 0 ? (
				<div className="space-y-2 border-b py-3" aria-busy>
					<SettingSkeleton className="w-40" />
					<SettingSkeleton className="block w-72" />
				</div>
			) : (
				ordered.map((preset, index) => (
					<WorkflowRow
						key={preset.name}
						id={rowId(index)}
						shell={shell}
						preset={preset}
						presets={ordered}
						isDefault={preset.name === workflow.name}
						disabled={disabled}
						saves={saves}
						notice={notice?.name === preset.name ? notice.text : undefined}
						onNotice={(text, about = preset.name) =>
							setNotice({ name: about, text })
						}
						focusMenu={focusMenu === preset.name}
						onRenamed={setFocusMenu}
						apply={apply}
					/>
				))
			)}
			<GroupHeading>{W.repositoryGroup}</GroupHeading>
			<DisclosureRow
				id="repositoryWorkflows"
				title={W.repositoryFiles}
				description={W.repositoryFilesHint}
			>
				<ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
					{W.repositoryLimits.map((limit) => (
						<li key={limit}>{limit}</li>
					))}
				</ul>
			</DisclosureRow>
			{dialog === "saveAs" ? (
				<SaveAsDialog
					open
					presets={presets}
					busy={saves.busy === "saveAs"}
					error={saves.errorFor("saveAs")}
					onSave={(name, asDefault) => void saveAs(name, asDefault)}
					onCancel={() => setDialog(undefined)}
				/>
			) : null}
			{dialog === "import" ? (
				<ImportDialog
					open
					presets={presets}
					busy={saves.busy === "import"}
					error={saves.errorFor("import")}
					onImport={async (recipe) => {
						const result = await saves.save("import", () =>
							shell.client.savePreset({
								name: recipe.name,
								revision: recipe.revision,
								config: recipe.config,
							}),
						);
						if (!result.ok) return;
						apply(result.value);
						setDialog(undefined);
						setNotice({
							name: "",
							text: W.imported(recipe.name),
						});
					}}
					onCancel={() => setDialog(undefined)}
				/>
			) : null}
		</>
	);
}

/**
 * One saved workflow: name ("Built in" for Hands-off), its summary, the
 * Default pill or Make default, and a menu. Rename edits the name in place.
 */
function WorkflowRow({
	id,
	shell,
	preset,
	presets,
	isDefault,
	disabled,
	saves,
	notice,
	onNotice,
	focusMenu,
	onRenamed,
	apply,
}: {
	id: string;
	shell: SettingsShell;
	preset: FactoryPreset;
	presets: readonly FactoryPreset[];
	isDefault: boolean;
	disabled: boolean;
	saves: Saves;
	notice?: string;
	/** `about` names the row it belongs to; "" puts it under the title. */
	onNotice: (text: string, about?: string) => void;
	focusMenu: boolean;
	onRenamed: (name: string) => void;
	apply: (items: FactoryPreset[], nextDefault?: string) => void;
}) {
	const { name } = preset;
	const builtIn = isBuiltIn(name);
	const [renaming, setRenaming] = useState(false);
	const [draft, setDraft] = useState(name);
	const [renameProblem, setRenameProblem] = useState<string>();
	const [deleting, setDeleting] = useState(false);
	const [copyError, setCopyError] = useState<string>();
	const keepFocus = useRef(false);
	const menuButton = useRef<HTMLButtonElement>(null);
	const restoreFocus = useRef(false);
	const busy = saves.busy === id;
	const error = renameProblem ?? copyError ?? saves.errorFor(id);

	const makeDefault = async () => {
		const result = await saves.save(id, () =>
			shell.client.savePreset({
				name,
				config: preset.config,
				useByDefault: true,
			}),
		);
		if (result.ok) {
			apply(result.value, name);
			onNotice(W.madeDefault(name));
		}
	};

	const duplicate = async () => {
		const copy = copyName(name, presets);
		const result = await saves.save(id, () =>
			shell.client.savePreset({ name: copy, config: preset.config }),
		);
		if (result.ok) {
			apply(result.value);
			onNotice(W.duplicated(copy));
		}
	};

	const copyJson = () => {
		setCopyError(undefined);
		void Promise.resolve()
			.then(() => navigator.clipboard.writeText(workflowJson(preset)))
			.then(
				() => onNotice(W.copied(name)),
				() => setCopyError(W.copyFailed),
			);
	};

	const rename = async () => {
		const next = draft.trim();
		const problem = workflowNameProblem(next, presets, name);
		setRenameProblem(problem);
		if (problem) return;
		if (next === name) {
			setRenaming(false);
			return;
		}
		const result = await saves.save(id, () =>
			shell.client.renamePreset(name, next),
		);
		if (!result.ok) return;
		apply(result.value, isDefault ? next : undefined);
		setRenaming(false);
		onRenamed(next);
		onNotice(W.renamed(next), next);
	};

	const remove = async (newDefault?: string) => {
		const result = await saves.save(id, () =>
			shell.client.deletePreset(name, newDefault),
		);
		if (!result.ok) return;
		setDeleting(false);
		apply(result.value, newDefault);
		onNotice(W.deleted(name), "");
	};

	const cancelRename = () => {
		restoreFocus.current = true;
		setRenaming(false);
		setRenameProblem(undefined);
		setDraft(name);
	};
	// Back from renaming (the menu button was not rendered meanwhile).
	useEffect(() => {
		if (renaming || !(restoreFocus.current || focusMenu)) return;
		restoreFocus.current = false;
		menuButton.current?.focus();
	}, [renaming, focusMenu]);

	return (
		<div
			data-setting={id}
			data-workflow={name}
			className="flex items-center justify-between gap-5 border-b py-3"
		>
			<div className="min-w-0 flex-1">
				{renaming ? (
					<Input
						autoFocus
						aria-label={W.renameLabel(name)}
						aria-invalid={Boolean(renameProblem)}
						aria-describedby={`${id}-description`}
						className="h-7 max-w-[320px] text-sm"
						value={draft}
						disabled={busy}
						onChange={(event) => {
							setDraft(event.target.value);
							setRenameProblem(undefined);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void rename();
							} else if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								cancelRename();
							}
						}}
					/>
				) : (
					<p
						id={`${id}-title`}
						className="flex min-w-0 items-center gap-2 text-sm font-medium"
					>
						<span className="truncate">{name}</span>
						{builtIn ? <StatusPill>{W.builtIn}</StatusPill> : null}
					</p>
				)}
				<p
					id={`${id}-description`}
					className="mt-0.5 max-w-[490px] text-xs text-muted-foreground"
				>
					{workflowSummary(preset.config)}
				</p>
				{notice && !error ? (
					<output className="mt-0.5 block text-xs text-muted-foreground">
						{notice}
					</output>
				) : null}
				{error ? (
					<p role="alert" className="mt-1 text-xs text-destructive">
						{error}
					</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{renaming ? (
					<>
						<ActionButton disabled={busy} onClick={cancelRename}>
							{FS_SHELL.cancel}
						</ActionButton>
						<ActionButton primary disabled={busy} onClick={() => void rename()}>
							{FS_SHELL.save}
						</ActionButton>
					</>
				) : (
					<>
						{isDefault ? (
							<StatusPill tone="success">
								<span
									aria-hidden
									className="size-1.5 rounded-full bg-current"
								/>
								{W.defaultPill}
							</StatusPill>
						) : (
							<ActionButton
								disabled={disabled}
								aria-describedby={`${id}-title`}
								onClick={() => void makeDefault()}
							>
								{W.makeDefault}
							</ActionButton>
						)}
						<DropdownMenu modal={false}>
							<DropdownMenuTrigger asChild>
								<Button
									ref={menuButton}
									variant="ghost"
									size="xs"
									disabled={disabled}
									aria-label={FS_SHELL.moreActions(name)}
									className="h-[26px] w-[26px] p-0 text-muted-foreground"
								>
									<MoreHorizontal aria-hidden className="size-4" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="end"
								className="min-w-[184px]"
								onCloseAutoFocus={(event) => {
									if (!keepFocus.current) return;
									keepFocus.current = false;
									event.preventDefault();
								}}
							>
								{builtIn ? null : (
									<DropdownMenuItem
										onSelect={() => {
											keepFocus.current = true;
											setDraft(name);
											setRenameProblem(undefined);
											setRenaming(true);
										}}
									>
										{W.menu.rename}
									</DropdownMenuItem>
								)}
								<DropdownMenuItem onSelect={() => void duplicate()}>
									{W.menu.duplicate}
								</DropdownMenuItem>
								{preset.revision ? (
									<DropdownMenuItem onSelect={copyJson}>
										{W.menu.copyJson}
									</DropdownMenuItem>
								) : null}
								{builtIn ? null : (
									<DropdownMenuItem
										variant="destructive"
										onSelect={() => setDeleting(true)}
									>
										{W.menu.delete}
									</DropdownMenuItem>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					</>
				)}
			</div>
			{deleting && isDefault ? (
				<DeleteDefaultDialog
					open
					name={name}
					others={presets
						.map((item) => item.name)
						.filter((other) => other !== name)}
					busy={busy}
					error={saves.errorFor(id)}
					onDelete={(newDefault) => void remove(newDefault)}
					onCancel={() => setDeleting(false)}
				/>
			) : (
				<ConfirmDialog
					open={deleting}
					title={W.deleteTitle(name)}
					body={W.deleteBody}
					verb={W.deleteVerb}
					busy={busy}
					error={saves.errorFor(id)}
					onConfirm={() => void remove()}
					onCancel={() => setDeleting(false)}
				/>
			)}
		</div>
	);
}

export const settingsPage: SettingsPageDefinition = {
	Page: WorkflowsPage,
	search: [
		{ row: "workflow-0", title: W.savedGroup, description: W.scope },
		{ row: "saveWorkflowAs", title: W.saveAsTitle, description: W.saveAsBody },
		{ row: "importWorkflow", title: W.importTitle, description: W.importBody },
		{
			row: "repositoryWorkflows",
			title: W.repositoryFiles,
			description: W.repositoryFilesHint,
		},
	],
};
