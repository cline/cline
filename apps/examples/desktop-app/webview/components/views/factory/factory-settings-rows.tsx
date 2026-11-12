"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { FACTORY_SETTINGS } from "@/lib/factory-copy";
import { parseFactoryCostInput } from "@/lib/factory-limits";
import { cn } from "@/lib/utils";
import type { DefaultWorkflow } from "./factory-settings";

/**
 * The app's settings row, compact variant (as in notification settings):
 * title and description on the left, one control on the right. `wrap` lets
 * a wide control (a list of model pickers) move under the text when the
 * content column is narrow.
 */
export function SettingRow({
	id,
	title,
	description,
	extra,
	error,
	top = false,
	wrap = false,
	children,
}: {
	/** Prefix for the title and description ids the control points at. */
	id: string;
	title: ReactNode;
	description?: ReactNode;
	/** Under the description: a note, a warning or a validation message. */
	extra?: ReactNode;
	error?: string | null;
	/** Align the control with the title when the description wraps. */
	top?: boolean;
	wrap?: boolean;
	children?: ReactNode;
}) {
	return (
		<div
			data-setting={id}
			className={cn(
				"flex justify-between gap-5 border-b py-3",
				top ? "items-start" : "items-center",
				wrap &&
					"@max-[560px]/settings:flex-col @max-[560px]/settings:items-stretch",
			)}
		>
			<div className="min-w-0 flex-1">
				<p id={`${id}-title`} className="text-sm font-medium">
					{title}
				</p>
				{description ? (
					<p
						id={`${id}-description`}
						className="mt-0.5 max-w-[490px] text-xs text-muted-foreground"
					>
						{description}
					</p>
				) : null}
				{extra}
				{error ? (
					<p role="alert" className="mt-1 text-xs text-destructive">
						{error}
					</p>
				) : null}
			</div>
			{children ? (
				<div
					className={cn(
						"flex max-w-[460px] shrink-0 flex-wrap items-center justify-end gap-1.5",
						wrap && "@max-[560px]/settings:justify-start",
					)}
				>
					{children}
				</div>
			) : null}
		</div>
	);
}

/** "Your approval", "Limits": a group's heading with its rule. */
export function GroupHeading({
	children,
	hint,
}: {
	children: ReactNode;
	hint?: ReactNode;
}) {
	return (
		<h3 className="mt-[18px] flex items-baseline gap-2 border-b pb-1.5 text-xs font-semibold text-muted-foreground">
			{children}
			{hint ? <span className="font-normal">{hint}</span> : null}
		</h3>
	);
}

/** The control's accessible name and description, from its row. */
export function rowLabels(id: string, described = true) {
	return {
		"aria-labelledby": `${id}-title`,
		...(described ? { "aria-describedby": `${id}-description` } : {}),
	};
}

export function SettingSelect<Value extends string>({
	id,
	value,
	options,
	disabled,
	onChange,
	className,
}: {
	/** The row id: the select is labelled by its title and description. */
	id: string;
	value: Value | undefined;
	options: readonly {
		value: Value;
		label: string;
		disabled?: boolean;
	}[];
	disabled?: boolean;
	onChange: (value: Value) => void;
	className?: string;
}) {
	return (
		<Select
			value={value}
			disabled={disabled}
			onValueChange={(next) => {
				if (next && next !== value) onChange(next as Value);
			}}
		>
			<SelectTrigger
				size="sm"
				data-setting-control={id}
				className={cn("min-w-44 justify-between", className)}
				{...rowLabels(id)}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent align="end">
				{options.map((option) => (
					<SelectItem
						key={option.value}
						value={option.value}
						disabled={option.disabled}
					>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * The text of a number field that commits on blur or Enter: it follows the
 * saved value (a reply or a rollback) unless the text already says the same
 * number, and reports only valid changes. Invalid text is shown, never saved.
 */
export function useCommittedText<T extends number | null>(
	value: T,
	{
		parse,
		format,
	}: {
		parse: (text: string) => { ok: true; value: T } | { ok: false };
		format: (value: T) => string;
	},
) {
	const [text, setText] = useState(() => format(value));
	// biome-ignore lint/correctness/useExhaustiveDependencies: `parse` and `format` are fixed per field.
	useEffect(() => {
		setText((previous) => {
			const shown = parse(previous);
			return shown.ok && shown.value === value ? previous : format(value);
		});
	}, [value]);
	const parsed = parse(text);
	return {
		text,
		setText,
		valid: parsed.ok,
		/** The value to save, when the text is valid and different. */
		changed: (): { value: T } | undefined =>
			parsed.ok && parsed.value !== value ? { value: parsed.value } : undefined,
	};
}

/** A dollar amount: empty is no limit (`null`). */
export function useCostText(
	value: number | null,
	bounds: { min: number; max: number },
) {
	return useCommittedText<number | null>(value, {
		parse: (text) => parseFactoryCostInput(text, bounds),
		format: (amount) => (amount === null ? "" : amount.toFixed(2)),
	});
}

/** Section title, scope line and, on a load failure, the way to retry. */
export function SectionTitle({
	id,
	title,
	scope,
	workflow,
	action,
}: {
	id: string;
	title: string;
	scope: string;
	workflow?: Pick<DefaultWorkflow, "presets">;
	action?: ReactNode;
}) {
	const loadError = workflow?.presets.error;
	return (
		<>
			<div className="flex items-end gap-3">
				<h2 id={id} className="text-base leading-[22px] font-semibold">
					{title}
				</h2>
				{action ? <div className="ml-auto">{action}</div> : null}
			</div>
			<p className="mt-0.5 text-[12.5px] leading-[18px] text-muted-foreground">
				{scope}
			</p>
			{loadError ? (
				<p role="alert" className="mt-2 text-xs text-destructive">
					{FACTORY_SETTINGS.loadFailed} {loadError}{" "}
					<Button
						variant="ghost"
						size="xs"
						disabled={workflow?.presets.loading}
						onClick={workflow?.presets.reload}
					>
						{FACTORY_SETTINGS.reload}
					</Button>
				</p>
			) : null}
		</>
	);
}
