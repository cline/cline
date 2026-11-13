"use client";

import {
	type FactoryVerificationProfile,
	factoryVerificationProfileSchema,
} from "@cline/shared/browser";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FS_SHELL } from "@/lib/factory-settings-copy/shell";
import { FS_TEST_SETUP } from "@/lib/factory-settings-copy/test-setup";
import { ConfirmDialog } from "../../../factory-settings-rows";

const T = FS_TEST_SETUP;

type Draft = {
	install: string;
	start: string;
	readyWhen: string;
	readyTimeout: string;
	portVariable: string;
	stop: string;
	exercise: string;
	evidence: string;
	skills: string;
};

function draftFrom(profile?: FactoryVerificationProfile): Draft {
	const environment = profile?.environment;
	return {
		install: environment?.setup ?? "",
		start: environment?.start ?? "",
		readyWhen: environment?.healthcheck ?? "",
		readyTimeout: environment?.readyTimeoutSeconds
			? String(environment.readyTimeoutSeconds)
			: "",
		portVariable: environment?.portEnv ?? "",
		stop: environment?.cleanup ?? "",
		exercise: profile?.exercise ?? "",
		evidence: (profile?.artifacts ?? []).join("\n"),
		skills: (profile?.skills ?? []).join(", "),
	};
}

const list = (text: string, separator: RegExp) =>
	text
		.split(separator)
		.map((item) => item.trim())
		.filter(Boolean);

/** The draft as a profile the schema checks; empty fields are left out. */
function profileFrom(draft: Draft) {
	const text = (value: string) => value.trim() || undefined;
	const timeout = draft.readyTimeout.trim();
	const skills = list(draft.skills, /,/);
	return factoryVerificationProfileSchema.safeParse({
		schemaVersion: 1,
		environment: Object.fromEntries(
			Object.entries({
				setup: text(draft.install),
				start: text(draft.start),
				healthcheck: text(draft.readyWhen),
				cleanup: text(draft.stop),
				portEnv: text(draft.portVariable),
				readyTimeoutSeconds: timeout ? Number(timeout) : undefined,
			}).filter(([, value]) => value !== undefined),
		),
		exercise: draft.exercise,
		artifacts: list(draft.evidence, /\n/),
		...(skills.length ? { skills } : {}),
	});
}

function issueText(path: readonly PropertyKey[], message: string): string {
	const field = path.at(-1);
	if (path[0] === "exercise") return `${T.fields.exercise}: required.`;
	if (field === "portEnv")
		return `${T.fields.portVariable} must be an environment variable name.`;
	if (field === "readyTimeoutSeconds")
		return `${T.readyTimeout}: a whole number from 1 to 900.`;
	if (message === "Provide a setup or start command")
		return `${T.fields.install} or ${T.fields.start} is required.`;
	if (message === "A healthcheck needs a start command")
		return `${T.fields.readyWhen} needs ${T.fields.start}.`;
	return message;
}

/**
 * The test setup as a form, with the same labels as the read-only view.
 * Save opens a confirmation listing the commands the tester will run; only
 * the person's click there saves it (as approved on this computer).
 */
export function TestSetupEditor({
	initial,
	project,
	busy,
	error,
	onSave,
	onCancel,
}: {
	initial?: FactoryVerificationProfile;
	project: string;
	busy: boolean;
	/** A refusal from the save, shown in the confirmation. */
	error?: string;
	/** Resolves true when saved (the editor closes). */
	onSave: (profile: FactoryVerificationProfile) => Promise<boolean>;
	onCancel: () => void;
}) {
	const id = useId();
	const [draft, setDraft] = useState(() => draftFrom(initial));
	const [confirming, setConfirming] = useState(false);
	const [tried, setTried] = useState(false);
	const parsed = profileFrom(draft);
	const issues = parsed.success
		? []
		: [
				...new Set(
					parsed.error.issues.map((issue) =>
						issueText(issue.path, issue.message),
					),
				),
			];
	const field = (
		name: Exclude<keyof Draft, "exercise" | "evidence">,
		label: string,
		hint: string,
		extra?: { type?: string; className?: string },
	) => (
		<label htmlFor={`${id}-${name}`} className="block space-y-1 text-xs">
			<span className="font-medium">{label}</span>
			<Input
				id={`${id}-${name}`}
				type={extra?.type}
				className={extra?.className ?? "h-8 font-mono text-[12.5px]"}
				placeholder={hint}
				value={draft[name]}
				disabled={busy}
				onChange={(event) =>
					setDraft((current) => ({ ...current, [name]: event.target.value }))
				}
			/>
		</label>
	);
	const environment = parsed.success ? parsed.data.environment : undefined;
	const commands: [string, string][] = environment
		? (
				[
					[T.fields.install, environment.setup],
					[T.fields.start, environment.start],
					[T.fields.readyWhen, environment.healthcheck],
					[T.fields.stop, environment.cleanup],
				] as const
			).flatMap(([label, command]) => (command ? [[label, command]] : []))
		: [];
	return (
		<form
			data-setting="testSetupEditor"
			aria-label={`${T.editorTitle}, ${project}`}
			className="space-y-3 border-b py-3"
			onSubmit={(event) => {
				event.preventDefault();
				setTried(true);
				if (parsed.success) setConfirming(true);
			}}
		>
			<p className="text-xs text-muted-foreground">{T.editorHint}</p>
			<div className="grid grid-cols-2 gap-3 @max-[560px]/settings:grid-cols-1">
				{field("install", T.fields.install, T.editorFieldHints.install)}
				{field("start", T.fields.start, T.editorFieldHints.start)}
				{field("readyWhen", T.fields.readyWhen, T.editorFieldHints.readyWhen)}
				<div className="grid grid-cols-2 gap-3">
					{field("readyTimeout", T.readyTimeout, "120", {
						type: "number",
						className: "h-8 text-[12.5px] tabular-nums",
					})}
					{field(
						"portVariable",
						T.fields.portVariable,
						T.editorFieldHints.portVariable,
					)}
				</div>
				{field("stop", T.fields.stop, T.editorFieldHints.stop)}
				{field("skills", T.fields.skills, T.editorFieldHints.skills, {
					className: "h-8 text-[12.5px]",
				})}
			</div>
			<label htmlFor={`${id}-exercise`} className="block space-y-1 text-xs">
				<span className="font-medium">{T.fields.exercise}</span>
				<Textarea
					id={`${id}-exercise`}
					rows={3}
					className="text-[12.5px]"
					placeholder={T.editorFieldHints.exercise}
					value={draft.exercise}
					disabled={busy}
					onChange={(event) =>
						setDraft((current) => ({
							...current,
							exercise: event.target.value,
						}))
					}
				/>
			</label>
			<label htmlFor={`${id}-evidence`} className="block space-y-1 text-xs">
				<span className="font-medium">{T.fields.evidence}</span>
				<Textarea
					id={`${id}-evidence`}
					rows={2}
					className="font-mono text-[12.5px]"
					placeholder={T.editorFieldHints.evidence}
					value={draft.evidence}
					disabled={busy}
					onChange={(event) =>
						setDraft((current) => ({
							...current,
							evidence: event.target.value,
						}))
					}
				/>
			</label>
			{tried && issues.length ? (
				<p role="alert" className="text-xs text-destructive">
					{issues.join(" ")}
				</p>
			) : null}
			<p className="text-xs text-muted-foreground">{T.runsAsYou}</p>
			<div className="flex justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={busy}
					onClick={onCancel}
				>
					{FS_SHELL.cancel}
				</Button>
				<Button type="submit" size="sm" disabled={busy}>
					{T.review}
				</Button>
			</div>
			<ConfirmDialog
				open={confirming}
				title={T.confirmTitle}
				body={T.confirmBody}
				detail={
					<span data-test-setup-confirm="" className="block space-y-1">
						{commands.map(([label, command]) => (
							<span key={label} className="block">
								<span className="text-muted-foreground">{label}: </span>
								<code className="font-mono text-xs break-all">{command}</code>
							</span>
						))}
					</span>
				}
				verb={T.confirmVerb}
				danger={false}
				busy={busy}
				error={error}
				onCancel={() => setConfirming(false)}
				onConfirm={() => {
					if (!parsed.success) return;
					void onSave(parsed.data).then((saved) => {
						if (saved) setConfirming(false);
					});
				}}
			/>
		</form>
	);
}
