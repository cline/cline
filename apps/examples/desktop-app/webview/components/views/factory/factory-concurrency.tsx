"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { useFactoryLimits } from "@/hooks/use-factory-limits";
import {
	FACTORY_SPENDING,
	factoryWorkingLimit,
	factoryWorkingOverLimit,
} from "@/lib/factory-copy";
import {
	FACTORY_CONCURRENCY_MAX,
	FACTORY_CONCURRENCY_MIN,
	type FactoryLimits,
	parseFactoryCostInput,
} from "@/lib/factory-limits";
import { cn } from "@/lib/utils";
import { toneText } from "./factory-ui";

export const FACTORY_CONCURRENCY_CONTROL_ID = "factory-concurrency";

const CHOICES = Array.from(
	{ length: FACTORY_CONCURRENCY_MAX - FACTORY_CONCURRENCY_MIN + 1 },
	(_, index) => FACTORY_CONCURRENCY_MIN + index,
);

/** App-level setting: how much Factory work the Hub runs at once. */
export function FactoryConcurrencyControl({
	state,
	className,
}: {
	state: ReturnType<typeof useFactoryLimits>;
	className?: string;
}) {
	const { limits, loading, saving, setConcurrency } = state;
	// A failed daily-limit change shows with the daily limit, not here.
	const error = state.errorFor === "dailyCostUsd" ? null : state.error;
	const unsupported = limits?.supported === false;
	return (
		<section
			aria-label="Work at once"
			className={cn("rounded-lg border px-4 py-3 text-sm", className)}
		>
			<label
				htmlFor={FACTORY_CONCURRENCY_CONTROL_ID}
				className="flex flex-wrap items-center gap-2"
			>
				<span>Work on up to</span>
				<select
					id={FACTORY_CONCURRENCY_CONTROL_ID}
					className="h-8 rounded-md border bg-background px-2 text-sm"
					value={limits?.supported ? String(limits.concurrency) : ""}
					disabled={loading || saving || !limits?.supported}
					onChange={(event) => void setConcurrency(Number(event.target.value))}
				>
					{limits?.supported ? null : <option value="">–</option>}
					{CHOICES.map((count) => (
						<option key={count} value={count}>
							{count}
						</option>
					))}
				</select>
				<span>at once</span>
			</label>
			<p className="mt-1 text-xs text-muted-foreground">
				{unsupported
					? "Update Cline to change this. This version of Factory does not have a limit setting."
					: "Other work waits in the queue and starts as slots free up."}
			</p>
			{error ? (
				<p role="alert" className="mt-1 text-xs text-destructive">
					{error}
				</p>
			) : null}
		</section>
	);
}

/**
 * Cards waiting only because every slot is in use: queued by the Hub and not
 * held. Held cards wait for the user, not for a slot.
 */
export function factoryWaitingForSlot(
	tasks: { factoryQueued?: "design" | "run"; factory?: { hold?: boolean } }[],
): number {
	return tasks.filter(
		(task) => task.factoryQueued !== undefined && task.factory?.hold !== true,
	).length;
}

/**
 * The limit beside the Working heading: "of 3", with an amber warning icon
 * while every slot is in use and its reason as the tooltip when more runs
 * than it allows. It opens the work-at-once control in a popover, so
 * changing it never leaves the home. Nothing shows while the Hub reports no
 * limit.
 */
export function FactoryWorkingLimit({
	running,
	state,
}: {
	running: number;
	state: ReturnType<typeof useFactoryLimits>;
}) {
	const limit = state.limits?.supported ? state.limits.concurrency : undefined;
	if (limit === undefined) return null;
	const over = factoryWorkingOverLimit(running, limit);
	// Every slot in use (or more, after a lowered limit): the link keeps its
	// colour and the warning rides on an icon.
	const full = running >= limit;
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="link"
					size="sm"
					data-factory-working-limit={over ? "over" : ""}
					title={over}
					// accent-11 keeps small link text at 4.5:1 on dark too; py-1
					// makes the small link a usable target.
					className="h-auto shrink-0 gap-1 px-0 py-1 text-xs font-normal text-accent-foreground"
					aria-label={`${factoryWorkingLimit(limit)}: ${over ?? "change how much work runs at once"}`}
				>
					{full ? (
						<AlertTriangle
							aria-hidden
							className={cn("size-3", toneText("attention"))}
						/>
					) : null}
					{factoryWorkingLimit(limit)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-0">
				<FactoryConcurrencyControl state={state} className="border-0" />
			</PopoverContent>
		</Popover>
	);
}

/** Whether every slot is in use, so queued work waits for a free one. */
export function factorySlotsFull(
	running: number,
	limits: FactoryLimits | undefined,
): boolean {
	return Boolean(limits?.supported && running >= limits.concurrency);
}

/**
 * A card's dollar limit in the per-card workflow editor. Empty means no
 * limit, shown as a plain warning. Every valid edit is reported; invalid
 * text never is.
 */
export function FactorySpendingField({
	before,
	hint,
	invalidMessage,
	value,
	min,
	max,
	disabled,
	showNoLimit,
	onApply,
}: {
	before: string;
	hint: string;
	invalidMessage: string;
	/** `null` or `undefined`: no limit. */
	value: number | null | undefined;
	min: number;
	max: number;
	disabled: boolean;
	/** Warn that nothing limits spending (when the value is truly unset). */
	showNoLimit: boolean;
	onApply: (value: number | null) => void;
}) {
	const id = useId();
	const current = value ?? null;
	const [text, setText] = useState(current === null ? "" : String(current));
	const parsed = parseFactoryCostInput(text, { min, max });
	// Follow outside changes (a preset) unless the text already says the
	// same amount.
	useEffect(() => {
		setText((previous) => {
			const shown = parseFactoryCostInput(previous, { min, max });
			return shown.ok && shown.value === current
				? previous
				: current === null
					? ""
					: String(current);
		});
	}, [current, min, max]);
	const apply = (next: string) => {
		const result = parseFactoryCostInput(next, { min, max });
		if (result.ok && result.value !== current) onApply(result.value);
	};
	return (
		<div className="text-sm">
			<label
				htmlFor={id}
				className="flex flex-wrap items-center gap-x-2 gap-y-1"
			>
				<span>{before}</span>
				<Input
					id={id}
					type="number"
					inputMode="decimal"
					min={min}
					max={max}
					step={0.01}
					placeholder="No limit"
					className="h-8 w-28"
					aria-invalid={!parsed.ok || undefined}
					value={text}
					disabled={disabled}
					onChange={(event) => {
						setText(event.target.value);
						apply(event.target.value);
					}}
				/>
			</label>
			<p className="mt-1 text-xs text-muted-foreground">{hint}</p>
			{!parsed.ok ? (
				<p role="alert" className="mt-1 text-xs text-destructive">
					{invalidMessage}
				</p>
			) : showNoLimit && !disabled && parsed.value === null ? (
				<p className={cn("mt-1 text-xs", toneText("attention"))}>
					{FACTORY_SPENDING.noLimit}
				</p>
			) : null}
		</div>
	);
}
