"use client";

import { useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FactoryPreset } from "@/lib/factory-presets";
import { FS_WORKFLOWS } from "@/lib/factory-settings-copy/workflows";
import {
	ActionButton,
	FormDialog,
	SettingSelect,
} from "../../../factory-settings-rows";
import {
	checkImport,
	type ImportCheck,
	workflowNameProblem,
	workflowPreview,
} from "./summary";

const W = FS_WORKFLOWS;

/** Save current as…: a name (not empty, not taken) and whether it becomes the default. */
export function SaveAsDialog({
	open,
	presets,
	busy,
	error,
	onSave,
	onCancel,
}: {
	open: boolean;
	presets: readonly FactoryPreset[];
	busy: boolean;
	error?: string;
	onSave: (name: string, asDefault: boolean) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState("");
	const [asDefault, setAsDefault] = useState(true);
	const [touched, setTouched] = useState(false);
	const problem = workflowNameProblem(name, presets);
	return (
		<FormDialog
			name="saveAs"
			open={open}
			title={W.saveAsTitle}
			description={W.saveAsBody}
			verb={W.saveVerb}
			busy={busy}
			error={error ?? (touched ? problem : undefined)}
			onSubmit={() => {
				setTouched(true);
				if (!problem) onSave(name.trim(), asDefault);
			}}
			onCancel={onCancel}
		>
			<div className="grid gap-1.5">
				<label htmlFor="workflow-save-as-name" className="text-xs font-medium">
					{W.saveAsName}
				</label>
				<Input
					id="workflow-save-as-name"
					autoFocus
					value={name}
					maxLength={120}
					disabled={busy}
					aria-invalid={touched && Boolean(problem)}
					onChange={(event) => {
						setName(event.target.value);
						setTouched(true);
					}}
				/>
			</div>
			<div className="flex items-start gap-2">
				<Checkbox
					id="workflow-save-as-default"
					checked={asDefault}
					disabled={busy}
					aria-describedby="workflow-save-as-default-hint"
					onCheckedChange={(checked) => setAsDefault(checked === true)}
				/>
				<div className="grid gap-0.5">
					<label
						htmlFor="workflow-save-as-default"
						className="text-xs font-medium"
					>
						{W.saveAsDefault}
					</label>
					<p
						id="workflow-save-as-default-hint"
						className="text-xs text-muted-foreground"
					>
						{W.saveAsDefaultHint}
					</p>
				</div>
			</div>
		</FormDialog>
	);
}

/**
 * Import…: paste (or choose) workflow JSON, check it against the shared
 * schema and the saved names, then show what it sets before saving it.
 * Importing never changes the default.
 */
export function ImportDialog({
	open,
	presets,
	busy,
	error,
	onImport,
	onCancel,
}: {
	open: boolean;
	presets: readonly FactoryPreset[];
	busy: boolean;
	error?: string;
	onImport: (recipe: Extract<ImportCheck, { ok: true }>) => void;
	onCancel: () => void;
}) {
	const [text, setText] = useState("");
	const [checked, setChecked] = useState<ImportCheck>();
	const file = useRef<HTMLInputElement>(null);
	const preview = checked?.ok ? checked : undefined;
	if (preview)
		return (
			<FormDialog
				name="importPreview"
				open={open}
				title={W.previewTitle(preview.name)}
				description={W.previewBody}
				verb={W.importVerb}
				busy={busy}
				error={error}
				secondary={{ label: W.back, onClick: () => setChecked(undefined) }}
				onSubmit={() => onImport(preview)}
				onCancel={onCancel}
			>
				<dl
					data-workflow-preview=""
					className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-lg border bg-card px-3 py-2.5 text-xs"
				>
					{workflowPreview(preview.config).map(([term, value]) => (
						<div key={term} className="contents">
							<dt className="text-muted-foreground">{term}</dt>
							<dd className="min-w-0 break-words">{value}</dd>
						</div>
					))}
				</dl>
			</FormDialog>
		);
	return (
		<FormDialog
			name="import"
			open={open}
			title={W.importTitle}
			description={W.importBody}
			verb={W.review}
			busy={busy}
			canSubmit={Boolean(text.trim())}
			error={checked && !checked.ok ? checked.error : undefined}
			onSubmit={() => setChecked(checkImport(text, presets))}
			onCancel={onCancel}
		>
			<div className="grid gap-1.5">
				<div className="flex items-center justify-between gap-2">
					<label htmlFor="workflow-import-json" className="text-xs font-medium">
						{W.importField}
					</label>
					<ActionButton onClick={() => file.current?.click()}>
						{W.chooseFile}
					</ActionButton>
					<input
						ref={file}
						type="file"
						accept=".json,application/json"
						className="hidden"
						tabIndex={-1}
						aria-hidden
						onChange={(event) => {
							const chosen = event.target.files?.[0];
							event.target.value = "";
							if (!chosen) return;
							void chosen.text().then(
								(value) => {
									setText(value);
									setChecked(undefined);
								},
								() => setChecked({ ok: false, error: W.readFileFailed }),
							);
						}}
					/>
				</div>
				<Textarea
					id="workflow-import-json"
					autoFocus
					rows={8}
					className="max-h-[40vh] font-mono text-xs"
					placeholder={W.importPlaceholder}
					value={text}
					disabled={busy}
					onChange={(event) => {
						setText(event.target.value);
						setChecked(undefined);
					}}
				/>
			</div>
		</FormDialog>
	);
}

/**
 * Deleting the default: the person picks which workflow new work uses
 * instead (Hands-off first), sent as `newDefault`.
 */
export function DeleteDefaultDialog({
	open,
	name,
	others,
	busy,
	error,
	onDelete,
	onCancel,
}: {
	open: boolean;
	name: string;
	others: readonly string[];
	busy: boolean;
	error?: string;
	onDelete: (newDefault: string) => void;
	onCancel: () => void;
}) {
	const [choice, setChoice] = useState<string>();
	const value = choice && others.includes(choice) ? choice : others[0];
	return (
		<FormDialog
			name="deleteDefault"
			open={open}
			title={W.deleteTitle(name)}
			description={W.deleteDefaultBody}
			verb={W.deleteVerb}
			danger
			busy={busy}
			canSubmit={Boolean(value)}
			error={error}
			onSubmit={() => {
				if (value) onDelete(value);
			}}
			onCancel={onCancel}
		>
			<div className="flex items-center justify-between gap-3">
				<div>
					<p id="newDefault-title" className="text-xs font-medium">
						{W.newDefault}
					</p>
					<p
						id="newDefault-description"
						className="text-xs text-muted-foreground"
					>
						{W.newDefaultHint}
					</p>
				</div>
				<SettingSelect
					id="newDefault"
					value={value}
					disabled={busy}
					options={others.map((other) => ({ value: other, label: other }))}
					onChange={setChoice}
				/>
			</div>
		</FormDialog>
	);
}
