"use client";

import { useRef, useState } from "react";
import {
	type FactoryResetResult,
	type FactoryResetWhat,
	factorySettingsErrorMessage,
	isUnavailable,
} from "@/lib/factory-settings-client";
import { FS_DATA } from "@/lib/factory-settings-copy/data-reset";
import { fsConfirmTitle } from "@/lib/factory-settings-copy/shell";
import {
	ActionButton,
	FormDialog,
	SettingRow,
} from "../../../factory-settings-rows";
import type { SettingsShell } from "../../types";
import { useRowSaves } from "../../use-settings-resource";

const D = FS_DATA;

export type DangerAction = {
	what: FactoryResetWhat;
	row: string;
	title: string;
	hint: string;
	label: string;
	verb: string;
	/** What a dry run (or the reset itself) will change / changed. */
	count: (reply: FactoryResetResult) => string;
	done: (reply: FactoryResetResult) => string;
};

const roleNames = (reply: FactoryResetResult) =>
	(reply.roles ?? []).map((role) => D.roles[role] ?? role);

export const DANGER_ACTIONS: readonly DangerAction[] = [
	{
		what: "stage_trust",
		row: "forgetStageApprovals",
		title: D.forgetStages,
		hint: D.forgetStagesHint,
		label: D.forget,
		verb: D.forgetVerb,
		count: (r) => D.count.stages(r.stages ?? 0, r.projects ?? 0),
		done: (r) => D.done.stages(r.stages ?? 0, r.projects ?? 0),
	},
	{
		what: "verification_trust",
		row: "forgetTestSetupApprovals",
		title: D.forgetVerification,
		hint: D.forgetVerificationHint,
		label: D.forget,
		verb: D.forgetVerb,
		count: (r) => D.count.verification(r.projects ?? 0),
		done: (r) => D.done.verification(r.projects ?? 0),
	},
	{
		what: "user_guidance",
		row: "clearGuidance",
		title: D.clearGuidance,
		hint: D.clearGuidanceHint,
		label: D.clear,
		verb: D.clearVerb,
		count: (r) => D.count.guidance(roleNames(r)),
		done: (r) => D.done.guidance(r.roles?.length ?? 0),
	},
	{
		what: "settings",
		row: "resetSettings",
		title: D.resetSettings,
		hint: D.resetSettingsHint,
		label: D.reset,
		verb: D.resetVerb,
		count: (r) => D.count.settings(r.concurrency ?? 2, r.dailyCostUsd ?? 50),
		done: () => D.done.settings,
	},
];

/**
 * One danger-zone action: a red button that opens a confirmation stating,
 * from a dry run, exactly what changes; the reset runs only on the verb.
 */
export function DangerRow({
	action,
	shell,
	disabled,
	onUnavailable,
}: {
	action: DangerAction;
	shell: SettingsShell;
	disabled: boolean;
	onUnavailable: (reason: "build" | "hub") => void;
}) {
	const saves = useRowSaves(shell.saved);
	const [open, setOpen] = useState(false);
	const [count, setCount] = useState<
		| { status: "loading" }
		| { status: "ready"; text: string }
		| { status: "error"; text: string }
	>({ status: "loading" });
	const [done, setDone] = useState<string>();
	const attempt = useRef(0);
	const busy = saves.busy === action.row;

	const start = () => {
		const current = ++attempt.current;
		setOpen(true);
		setDone(undefined);
		setCount({ status: "loading" });
		shell.client.reset({ what: action.what, dryRun: true }).then(
			(reply) => {
				if (current === attempt.current)
					setCount({ status: "ready", text: action.count(reply) });
			},
			(cause: unknown) => {
				if (current !== attempt.current) return;
				if (isUnavailable(cause)) {
					setOpen(false);
					onUnavailable(cause.reason);
					return;
				}
				setCount({
					status: "error",
					text: factorySettingsErrorMessage(cause, D.countFailed),
				});
			},
		);
	};

	const confirm = async () => {
		const result = await saves.save(action.row, () =>
			shell.client.reset({ what: action.what }),
		);
		if (!result.ok) return;
		setOpen(false);
		setDone(action.done(result.value));
		if (action.what === "settings") {
			shell.workflow.presets.reload();
			shell.limits.reload();
		} else shell.projectsSummary.reload();
	};

	return (
		<SettingRow
			id={action.row}
			title={action.title}
			description={action.hint}
			extra={
				done ? (
					<output className="mt-0.5 block text-xs text-muted-foreground">
						{done}
					</output>
				) : null
			}
			error={open ? undefined : saves.errorFor(action.row)}
			top
		>
			<ActionButton
				danger
				disabled={disabled || busy}
				aria-describedby={`${action.row}-title`}
				onClick={start}
			>
				{action.label}
			</ActionButton>
			{open ? (
				<FormDialog
					name={`reset-${action.what}`}
					open
					danger
					title={fsConfirmTitle(action.title)}
					description={action.hint}
					verb={action.verb}
					busy={busy}
					canSubmit={count.status === "ready"}
					error={
						count.status === "error" ? count.text : saves.errorFor(action.row)
					}
					onSubmit={() => void confirm()}
					onCancel={() => {
						attempt.current++;
						setOpen(false);
					}}
				>
					<div className="space-y-1.5 text-xs">
						<p
							data-reset-count=""
							className="font-medium text-foreground"
							aria-live="polite"
						>
							{count.status === "ready"
								? count.text
								: count.status === "loading"
									? D.counting
									: null}
						</p>
						<p className="text-muted-foreground">{D.keeps}</p>
					</div>
				</FormDialog>
			) : null}
		</SettingRow>
	);
}
