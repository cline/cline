"use client";

import { isFactoryHandsOff } from "@cline/shared/browser";
import { useEffect, useRef } from "react";
import { FACTORY_SETTINGS, FACTORY_SPENDING } from "@/lib/factory-copy";
import {
	FACTORY_CARD_COST_DEFAULT_USD,
	FACTORY_CARD_COST_MAX_USD,
	FACTORY_CONCURRENCY_MAX,
	FACTORY_CONCURRENCY_MIN,
	FACTORY_DAILY_COST_MAX_USD,
	factoryDailyCostSupported,
	formatFactoryUsd,
} from "@/lib/factory-limits";
import { FS_LIMITS } from "@/lib/factory-settings-copy/limits";
import { FS_PAGES, FS_SHELL } from "@/lib/factory-settings-copy/shell";
import { cn } from "@/lib/utils";
import {
	ActionButton,
	CostField,
	DisclosureRow,
	GroupHeading,
	PageTitle,
	SettingRow,
	SettingSelect,
	SettingsBanner,
	useCostText,
} from "../../factory-settings-rows";
import { toneText } from "../../factory-ui";
import { WorkflowLoadError } from "../shell-parts";
import type {
	SettingsPageDefinition,
	SettingsPageProps,
	SettingsShell,
} from "../types";

const L = FS_LIMITS;

/**
 * Limits & spending: the Hub's limits for this computer (save at once, apply
 * to running work) and the default workflow's card limit.
 */
function LimitsPage({ shell, headingId, focus }: SettingsPageProps) {
	const { limits } = shell;
	const paused =
		limits.limits?.supported === true && limits.limits.paused === true;
	return (
		<>
			<PageTitle id={headingId} title={FS_PAGES.limits} scope={L.scope} />
			{paused ? (
				<SettingsBanner
					title={L.pausedTitle}
					actions={
						<ActionButton
							primary
							disabled={limits.saving || shell.readOnly}
							onClick={() => void limits.setPaused(false)}
						>
							{L.resume}
						</ActionButton>
					}
				>
					{L.pausedBody}
				</SettingsBanner>
			) : null}
			<GroupHeading>{L.runningGroup}</GroupHeading>
			<WorkAtOnceRow shell={shell} />
			<GroupHeading>{L.spendingGroup}</GroupHeading>
			<DailyLimitRow shell={shell} focused={focus?.row === "dailyCostUsd"} />
			<CardLimitRow shell={shell} />
			<GroupHeading hint={L.builtInGroupHint}>{L.builtInGroup}</GroupHeading>
			<DisclosureRow
				id="builtInLimits"
				title={L.builtIn}
				description={L.builtInHint}
			>
				<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
					{L.builtInItems.map(([term, value]) => (
						<div key={term} className="contents">
							<dt className="text-muted-foreground">{term}</dt>
							<dd>{value}</dd>
						</div>
					))}
				</dl>
			</DisclosureRow>
		</>
	);
}

function WorkAtOnceRow({ shell }: { shell: SettingsShell }) {
	const { limits } = shell;
	const supported = limits.limits?.supported === true;
	const unsupported = limits.limits?.supported === false;
	const error =
		limits.errorFor === "concurrency" || limits.errorFor === "read"
			? limits.error
			: null;
	return (
		<SettingRow
			id="concurrency"
			title={L.workAtOnce}
			description={L.workAtOnceHint}
			extra={
				unsupported ? (
					<p className="mt-0.5 text-xs text-muted-foreground">
						{FS_SHELL.hubTooOld}
					</p>
				) : null
			}
			error={error}
		>
			<SettingSelect
				id="concurrency"
				className="min-w-0"
				value={
					limits.limits?.supported
						? String(limits.limits.concurrency)
						: undefined
				}
				disabled={
					limits.loading || limits.saving || !supported || shell.readOnly
				}
				options={Array.from(
					{ length: FACTORY_CONCURRENCY_MAX - FACTORY_CONCURRENCY_MIN + 1 },
					(_, index) => {
						const value = String(FACTORY_CONCURRENCY_MIN + index);
						return { value, label: value };
					},
				)}
				onChange={(value) => void limits.setConcurrency(Number(value))}
			/>
		</SettingRow>
	);
}

/** Today's spend against the limit: a bar and one line under the description. */
function SpentToday({ spent, limit }: { spent: number; limit: number }) {
	const share = limit > 0 ? Math.min(1, spent / limit) : 0;
	return (
		<div className="mt-2 flex items-center gap-2.5">
			<div
				aria-hidden
				className="h-1 w-[150px] overflow-hidden rounded-full bg-muted"
			>
				<div
					className={cn(
						"h-full rounded-full",
						share >= 1 ? "bg-destructive" : "bg-primary",
					)}
					style={{ width: `${share * 100}%` }}
				/>
			</div>
			<span className="text-xs text-muted-foreground tabular-nums">
				{L.spentToday(formatFactoryUsd(spent))}
			</span>
		</div>
	);
}

function DailyLimitRow({
	shell,
	focused,
}: {
	shell: SettingsShell;
	focused: boolean;
}) {
	const { limits } = shell;
	const current = limits.limits;
	const supported = factoryDailyCostSupported(current);
	const value = supported ? current.dailyCostUsd : null;
	const field = useCostText(value, { min: 0, max: FACTORY_DAILY_COST_MAX_USD });
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (focused && !limits.loading) inputRef.current?.focus();
	}, [focused, limits.loading]);
	return (
		<SettingRow
			id="dailyCostUsd"
			title={L.dailyLimit}
			description={L.dailyLimitHint}
			top
			extra={
				!limits.loading && !supported ? (
					<p className="mt-0.5 text-xs text-muted-foreground">
						{FACTORY_SPENDING.unsupported}
					</p>
				) : !field.valid ? (
					<p role="alert" className="mt-1 text-xs text-destructive">
						{FACTORY_SPENDING.dailyLimitInvalid(FACTORY_DAILY_COST_MAX_USD)}
					</p>
				) : supported && value === null ? (
					<p className={cn("mt-0.5 text-xs", toneText("attention"))}>
						{L.noDailyLimit}
					</p>
				) : supported &&
					value !== null &&
					current.spentTodayUsd !== undefined ? (
					<SpentToday spent={current.spentTodayUsd} limit={value} />
				) : null
			}
			error={limits.errorFor === "dailyCostUsd" ? limits.error : null}
		>
			<CostField
				id="dailyCostUsd"
				field={field}
				inputRef={inputRef}
				disabled={
					limits.loading || limits.saving || !supported || shell.readOnly
				}
				onCommit={(dailyCostUsd) => void limits.setDailyCostUsd(dailyCostUsd)}
			/>
			<span className="text-xs text-muted-foreground">{L.perDay}</span>
		</SettingRow>
	);
}

function CardLimitRow({ shell }: { shell: SettingsShell }) {
	const { workflow } = shell;
	const { config, commit, errorFor } = workflow;
	const value = config.maxCostUsd ?? null;
	const field = useCostText(value, {
		min: 0.01,
		max: FACTORY_CARD_COST_MAX_USD,
	});
	const empty = field.valid && field.text.trim() === "";
	return (
		<SettingRow
			id="maxCostUsd"
			title={L.cardLimit}
			top
			description={
				<>
					{L.cardLimitHint} {FS_SHELL.savedTo}{" "}
					<button
						type="button"
						className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() => shell.open({ page: "workflows" })}
					>
						{workflow.name}
					</button>
					.
				</>
			}
			extra={
				<>
					<WorkflowLoadError workflow={workflow} />
					{!field.valid ? (
						<p role="alert" className="mt-1 text-xs text-destructive">
							{FACTORY_SPENDING.cardLimitInvalid(FACTORY_CARD_COST_MAX_USD)}
						</p>
					) : empty ? (
						// Hands-off work stops at the built-in limit when none is set.
						isFactoryHandsOff(config) ? (
							<p className="mt-0.5 text-xs text-muted-foreground">
								{FACTORY_SETTINGS.general.cardBuiltInLimit(
									formatFactoryUsd(FACTORY_CARD_COST_DEFAULT_USD),
								)}
							</p>
						) : (
							<p className={cn("mt-0.5 text-xs", toneText("attention"))}>
								{FACTORY_SETTINGS.general.cardNoLimit}
							</p>
						)
					) : null}
				</>
			}
			error={errorFor("maxCostUsd")}
		>
			<CostField
				id="maxCostUsd"
				field={field}
				disabled={workflow.presets.loading || shell.readOnly}
				onCommit={(maxCostUsd) =>
					commit(
						{ ...config, maxCostUsd: maxCostUsd ?? undefined },
						"maxCostUsd",
					)
				}
			/>
		</SettingRow>
	);
}

export const settingsPage: SettingsPageDefinition = {
	Page: LimitsPage,
	search: [
		{ row: "concurrency", title: L.workAtOnce, description: L.workAtOnceHint },
		{ row: "dailyCostUsd", title: L.dailyLimit, description: L.dailyLimitHint },
		{ row: "maxCostUsd", title: L.cardLimit, description: L.cardLimitHint },
		{ row: "builtInLimits", title: L.builtIn, description: L.builtInHint },
	],
};
