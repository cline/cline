"use client";

import { formatFactoryId } from "@cline/shared/browser";
import {
	AlertTriangle,
	ArrowUpRight,
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	FolderOpen,
	Info,
} from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useState } from "react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { FACTORY_SETTINGS } from "@/lib/factory-copy";
import { parseFactoryCostInput } from "@/lib/factory-limits";
import { FS_AUTOMATION } from "@/lib/factory-settings-copy/automation";
import { FS_COPY, FS_SHELL } from "@/lib/factory-settings-copy/shell";
import { cn } from "@/lib/utils";
import {
	type FactoryTone,
	SECTION_LABEL,
	StatusPill,
	toneText,
} from "./factory-ui";

export { StatusPill };

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
	labelFor,
	children,
}: {
	/** Prefix for the title and description ids the control points at. */
	id: string;
	/** The control's id: the title becomes its label (a switch row, rule E). */
	labelFor?: string;
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
				{labelFor ? (
					<label
						id={`${id}-title`}
						htmlFor={labelFor}
						className="block cursor-pointer text-sm font-medium"
					>
						{title}
					</label>
				) : (
					<p id={`${id}-title`} className="text-sm font-medium">
						{title}
					</p>
				)}
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
		<h3
			className={cn(
				"mt-6 flex items-baseline gap-2 border-b pb-1.5",
				SECTION_LABEL,
			)}
		>
			{children}
			{hint ? (
				<span className="font-normal normal-case tracking-normal">{hint}</span>
			) : null}
		</h3>
	);
}

/**
 * A group heading with its hint, and a pill or one button at the right
 * ("Repository stages · cline · .cline/factory/stages.json [Add stage]").
 */
export function GroupHeadingRow({
	title,
	hint,
	pill,
	action,
}: {
	title: ReactNode;
	hint?: ReactNode;
	pill?: ReactNode;
	action?: ReactNode;
}) {
	if (!pill && !action) return <GroupHeading hint={hint}>{title}</GroupHeading>;
	return (
		<div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b pb-1.5">
			<h3
				className={cn(
					"flex min-w-0 flex-1 items-baseline gap-2",
					SECTION_LABEL,
				)}
			>
				{title}
				{hint ? (
					<span className="truncate font-normal normal-case tracking-normal">
						{hint}
					</span>
				) : null}
			</h3>
			<div className="flex shrink-0 items-center gap-1.5">
				{pill}
				{action}
			</div>
		</div>
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

/**
 * A page's title, its scope line and, on pages that edit the default
 * workflow, "Saved to the default workflow, {name}." with the name opening
 * Workflows. `action` sits at the right of the title (a project select,
 * "Check again"); `alert` under the scope (a load failure).
 */
export function PageTitle({
	id,
	title,
	scope,
	savedTo,
	action,
	alert,
}: {
	id: string;
	title: ReactNode;
	scope: ReactNode;
	savedTo?: { name: string; onOpen: () => void };
	action?: ReactNode;
	alert?: ReactNode;
}) {
	return (
		<div className="mb-1">
			<div className="flex min-h-[30px] items-center gap-3">
				<h2 id={id} className="text-base leading-[22px] font-semibold">
					{title}
				</h2>
				{action ? (
					<div className="ml-auto flex shrink-0 items-center gap-2">
						{action}
					</div>
				) : null}
			</div>
			<p
				data-page-scope=""
				className="mt-1 max-w-[640px] text-[12.5px] leading-[18px] text-muted-foreground"
			>
				{scope}
				{savedTo ? (
					<>
						{" "}
						{FS_SHELL.savedTo}{" "}
						<button
							type="button"
							className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={savedTo.onOpen}
						>
							{savedTo.name}
						</button>
						.
					</>
				) : null}
			</p>
			{alert}
		</div>
	);
}

/**
 * A card's short id ("F12") as a link: leaves settings and opens the card.
 * A card without a number reads "a card".
 */
export function CardLink({
	card,
	onOpen,
}: {
	card: { taskId: string; factoryNumber?: number };
	onOpen: (taskId: string) => void;
}) {
	return (
		<button
			type="button"
			data-card-link={card.taskId}
			className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={() => onOpen(card.taskId)}
		>
			{card.factoryNumber
				? formatFactoryId(card.factoryNumber)
				: FS_SHELL.aCard}
		</button>
	);
}

/** A whole number field that commits on blur or Enter. */
export function NumberField({
	id,
	value,
	min,
	max,
	disabled,
	onCommit,
	className,
	label,
}: {
	/** The row id: the field is labelled by its title and description. */
	id: string;
	value: number;
	min: number;
	max: number;
	disabled?: boolean;
	onCommit: (value: number) => void;
	className?: string;
	/** An own name, where one row has two fields (steps, minutes). */
	label?: string;
}) {
	const field = useCommittedText<number>(value, {
		parse: (text) => {
			const trimmed = text.trim();
			const number = Number(trimmed);
			return /^\d+$/.test(trimmed) && number >= min && number <= max
				? { ok: true, value: number }
				: { ok: false };
		},
		format: String,
	});
	const commit = () => {
		const change = field.changed();
		if (change) onCommit(change.value);
	};
	return (
		<div className="flex flex-col items-end gap-1">
			<Input
				type="number"
				min={min}
				max={max}
				step={1}
				data-setting-control={id}
				className={cn(
					"h-[30px] w-[46px] px-2 text-[13px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
					className,
				)}
				aria-invalid={!field.valid || undefined}
				disabled={disabled}
				value={field.text}
				{...(label ? { "aria-label": label } : rowLabels(id))}
				onChange={(event) => field.setText(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit();
				}}
			/>
			{field.valid ? null : (
				<p role="alert" className="text-xs text-destructive">
					{FS_AUTOMATION.numberInvalid(min, max)}
				</p>
			)}
		</div>
	);
}

/** A whole number that may be empty (no value); saves on blur or Enter. */
export function OptionalNumber({
	id,
	label,
	value,
	min,
	max,
	placeholder,
	disabled,
	onCommit,
}: {
	id: string;
	label: string;
	value: number | null;
	min: number;
	max: number;
	placeholder: string;
	disabled: boolean;
	onCommit: (value: number | null) => void;
}) {
	const field = useCommittedText<number | null>(value, {
		parse: (text) => {
			const trimmed = text.trim();
			if (!trimmed) return { ok: true, value: null };
			const number = Number(trimmed);
			return /^\d+$/.test(trimmed) && number >= min && number <= max
				? { ok: true, value: number }
				: { ok: false };
		},
		format: (number) => (number === null ? "" : String(number)),
	});
	const commit = () => {
		const change = field.changed();
		if (change) onCommit(change.value);
	};
	return (
		<span className="flex flex-col items-end gap-1">
			<Input
				type="number"
				min={min}
				max={max}
				step={1}
				data-setting-control={id}
				aria-label={label}
				aria-describedby={`${id}-description`}
				aria-invalid={!field.valid || undefined}
				placeholder={placeholder}
				className="h-[30px] w-[62px] px-2 text-[13px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				disabled={disabled}
				value={field.text}
				onChange={(event) => field.setText(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit();
				}}
			/>
			{field.valid ? null : (
				<span role="alert" className="text-xs text-destructive">
					{FS_SHELL.numberOrEmptyInvalid(min, max)}
				</span>
			)}
		</span>
	);
}

/** "$ [10.00]": a dollar field that commits on blur or Enter; empty is null. */
export function CostField({
	id,
	field,
	disabled,
	onCommit,
	inputRef,
}: {
	id: string;
	field: ReturnType<typeof useCostText>;
	disabled: boolean;
	onCommit: (value: number | null) => void;
	inputRef?: RefObject<HTMLInputElement | null>;
}) {
	const commit = () => {
		const change = field.changed();
		if (change) onCommit(change.value);
	};
	return (
		<InputGroup
			className="h-[30px] w-[78px]"
			data-disabled={disabled || undefined}
		>
			<InputGroupAddon className="pr-0 pl-2.5 text-xs">$</InputGroupAddon>
			<InputGroupInput
				ref={inputRef}
				id={`${id}-input`}
				data-setting-control={id}
				type="number"
				inputMode="decimal"
				step={0.01}
				placeholder={FACTORY_SETTINGS.general.noLimitPlaceholder}
				className="h-full [appearance:textfield] pr-2 pl-1 text-[13px] tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				aria-invalid={!field.valid || undefined}
				disabled={disabled}
				value={field.text}
				{...rowLabels(id)}
				onChange={(event) => field.setText(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit();
				}}
			/>
		</InputGroup>
	);
}

/**
 * A row that opens another settings page (or a project in one): the whole
 * row is one button named by its title and status, with a pill and a
 * chevron at the right.
 */
export function OpenRow({
	id,
	title,
	description,
	pill,
	label,
	disabled,
	onOpen,
}: {
	id: string;
	title: ReactNode;
	description?: ReactNode;
	/** A status pill: `{ tone, text }`. */
	pill?: { tone: FactoryTone; text: string };
	/** Text before the chevron ("Open", "Roles & models"). */
	label?: string;
	disabled?: boolean;
	onOpen: () => void;
}) {
	return (
		<div data-setting={id} data-row-kind="open" className="border-b">
			<button
				type="button"
				disabled={disabled}
				onClick={onOpen}
				aria-describedby={description ? `${id}-description` : undefined}
				// The hover fill reaches 8px past the text on each side as two
				// shadows, which paint without widening the row (no overflow).
				className="flex w-full items-center justify-between gap-5 rounded-md py-3 text-left hover:bg-surface-hover-lighter hover:shadow-[-8px_0_0_var(--color-surface-hover-lighter),8px_0_0_var(--color-surface-hover-lighter)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
			>
				<span className="min-w-0 flex-1">
					<span id={`${id}-title`} className="block text-sm font-medium">
						{title}
						{pill ? <span className="sr-only">{`, ${pill.text}`}</span> : null}
					</span>
					{description ? (
						<span
							id={`${id}-description`}
							className="mt-0.5 block max-w-[490px] text-xs text-muted-foreground"
						>
							{description}
						</span>
					) : null}
				</span>
				<span aria-hidden className="flex shrink-0 items-center gap-2">
					{pill ? <StatusPill tone={pill.tone}>{pill.text}</StatusPill> : null}
					{label ? (
						<span className="text-xs text-muted-foreground">{label}</span>
					) : null}
					<ChevronRight className="size-3.5 text-muted-foreground" />
				</span>
			</button>
		</div>
	);
}

/**
 * A row whose content is revealed under it: "Show" / "Hide" and a chevron
 * on the right, a button with `aria-expanded` and `aria-controls`.
 */
export function DisclosureRow({
	id,
	title,
	description,
	pill,
	label,
	openLabel,
	defaultOpen = false,
	children,
}: {
	id: string;
	title: ReactNode;
	description?: ReactNode;
	pill?: ReactNode;
	/** The closed button's text; "Show" by default. */
	label?: string;
	/** The open button's text; "Hide" by default. */
	openLabel?: string;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const contentId = `${id}-content`;
	return (
		<div data-setting={id} data-row-kind="disclosure" className="border-b">
			<div className="flex items-center justify-between gap-5 py-3">
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
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{pill}
					<Button
						variant="ghost"
						size="xs"
						aria-expanded={open}
						aria-controls={contentId}
						aria-describedby={`${id}-title`}
						className="h-[26px] gap-1 px-2 text-xs text-muted-foreground"
						onClick={() => setOpen((value) => !value)}
					>
						{open ? (openLabel ?? FS_SHELL.hide) : (label ?? FS_SHELL.show)}
						<ChevronDown
							aria-hidden
							className={cn(
								"size-3.5 transition-transform",
								open && "rotate-180",
							)}
						/>
					</Button>
				</div>
			</div>
			<div id={contentId} hidden={!open} className="pb-3">
				{open ? children : null}
			</div>
		</div>
	);
}

/**
 * A row's action: one outline button. Verbs ending in "…" open a
 * confirmation; `danger` is red text with a red border only on hover (rule
 * D); `outside` adds a trailing arrow and is only for browser URLs (rule G);
 * `folder` a leading Finder icon.
 */
export function ActionButton({
	children,
	onClick,
	disabled,
	danger,
	icon,
	primary,
	...rest
}: {
	children: ReactNode;
	onClick: () => void;
	disabled?: boolean;
	danger?: boolean;
	primary?: boolean;
	icon?: "outside" | "folder";
	"aria-describedby"?: string;
	"aria-label"?: string;
}) {
	return (
		<Button
			variant={primary ? "default" : "outline"}
			size="xs"
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"h-[26px] gap-1.5 px-2.5 text-xs",
				danger &&
					"text-error-text hover:border-destructive/60 hover:bg-destructive/10 hover:text-error-text",
			)}
			{...rest}
		>
			{icon === "folder" ? (
				<FolderOpen aria-hidden className="size-3.5" />
			) : null}
			{children}
			{icon === "outside" ? (
				<ArrowUpRight aria-hidden className="size-3" />
			) : null}
		</Button>
	);
}

/**
 * A modal confirmation: title, what happens, the count affected, and Cancel
 * (focused first) beside the verb. Focus returns to the button that opened
 * it.
 */
export function ConfirmDialog({
	open,
	title,
	body,
	detail,
	verb,
	danger = true,
	busy,
	error,
	onConfirm,
	onCancel,
}: {
	open: boolean;
	title: string;
	body: ReactNode;
	/** The count affected ("3 stages in 2 projects"). */
	detail?: ReactNode;
	verb: string;
	danger?: boolean;
	busy?: boolean;
	error?: string;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<AlertDialogContent data-settings-confirm="">
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-2">
							<p>{body}</p>
							{detail ? (
								<p className="font-medium text-foreground">{detail}</p>
							) : null}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error ? (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel autoFocus disabled={busy}>
						{FS_SHELL.cancel}
					</AlertDialogCancel>
					<Button
						variant={danger ? "destructive" : "default"}
						disabled={busy}
						onClick={onConfirm}
					>
						{verb}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/**
 * A modal with fields (Save as, Import, choosing a new default): title, what
 * happens, the fields, an error, and Cancel beside the verb. Enter in a field
 * submits. `ConfirmDialog` stays the one for plain confirmations; this is
 * for dialogs the person fills in.
 */
export function FormDialog({
	open,
	title,
	description,
	children,
	error,
	verb,
	danger,
	busy,
	canSubmit = true,
	secondary,
	onSubmit,
	onCancel,
	name,
}: {
	open: boolean;
	title: string;
	description: ReactNode;
	children?: ReactNode;
	error?: string;
	verb: string;
	danger?: boolean;
	busy?: boolean;
	canSubmit?: boolean;
	/** A second button before the verb ("Back"). */
	secondary?: { label: string; onClick: () => void };
	onSubmit: () => void;
	onCancel: () => void;
	/** `data-settings-dialog`, for tests and captures. */
	name: string;
}) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) onCancel();
			}}
		>
			<DialogContent
				showCloseButton={false}
				data-settings-dialog={name}
				className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-[520px]"
			>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (canSubmit && !busy) onSubmit();
					}}
				>
					<DialogHeader>
						<DialogTitle className="text-base">{title}</DialogTitle>
						<DialogDescription className="text-xs">
							{description}
						</DialogDescription>
					</DialogHeader>
					{children}
					{error ? (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={onCancel}
						>
							{FS_SHELL.cancel}
						</Button>
						{secondary ? (
							<Button
								type="button"
								variant="outline"
								disabled={busy}
								onClick={secondary.onClick}
							>
								{secondary.label}
							</Button>
						) : null}
						<Button
							type="submit"
							variant={danger ? "destructive" : "default"}
							disabled={busy || !canSubmit}
						>
							{verb}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/**
 * A page banner (`role="status"`): paused, proposed, changed outside
 * Factory. Buttons sit at the right and wrap under the text when narrow.
 */
export function SettingsBanner({
	tone = "attention",
	title,
	children,
	actions,
}: {
	tone?: Extract<FactoryTone, "attention" | "danger" | "neutral">;
	title?: ReactNode;
	children?: ReactNode;
	actions?: ReactNode;
}) {
	const Icon = tone === "neutral" ? Info : AlertTriangle;
	return (
		<output
			data-settings-banner={tone}
			className={cn(
				"mt-3 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-xs",
				tone === "attention" && "border-amber-500/40 bg-amber-500/5",
				tone === "danger" && "border-destructive/40 bg-destructive/5",
				tone === "neutral" && "bg-card",
			)}
		>
			<Icon
				aria-hidden
				className={cn("mt-0.5 size-3.5 shrink-0", toneText(tone))}
			/>
			<p className="min-w-[200px] flex-1 text-muted-foreground">
				{title ? (
					<span className="font-medium text-foreground">{title}</span>
				) : null}
				{title && children ? " " : null}
				{children}
			</p>
			{actions ? (
				<div className="ml-auto flex shrink-0 items-center gap-1.5">
					{actions}
				</div>
			) : null}
		</output>
	);
}

/**
 * The one line a row group shows when its command is missing from this build
 * (or its Hub is too old), in place of controls that would do nothing.
 */
export function UnavailableNote({
	reason = "build",
	children,
}: {
	reason?: "build" | "hub";
	/** Names the group: "Working copies: not available in this build." */
	children?: ReactNode;
}) {
	return (
		<p
			data-settings-unavailable={reason}
			className="border-b py-3 text-xs text-muted-foreground"
		>
			{children ??
				(reason === "hub" ? FS_SHELL.hubTooOld : FS_SHELL.notAvailable)}
		</p>
	);
}

/** A same-size grey block in place of a pill or value while loading. */
export function SettingSkeleton({ className }: { className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				"inline-block h-4 w-[60px] animate-pulse rounded bg-muted",
				className,
			)}
		/>
	);
}

/** "/Users/me/x" → "~/x" for display; the copy button copies the full path. */
export function tildePath(path: string): string {
	return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/**
 * A path or a command as selectable text under a row's description. There is
 * no "Show in Finder" command, so the text itself is what the person uses.
 */
export function CopyableText({
	text,
	display,
}: {
	text: string;
	display?: string;
}) {
	return (
		<code
			title={text}
			data-copyable-text=""
			className="mt-1 block max-w-[490px] break-all font-mono text-[11.5px] leading-[16px] text-muted-foreground select-text"
		>
			{display ?? text}
		</code>
	);
}

/**
 * Copies `text` to the clipboard: "Copy", then "Copied" for 2 seconds, or an
 * alert when the clipboard refuses.
 */
export function CopyButton({
	text,
	what,
	children = FS_COPY.copy,
}: {
	text: string;
	/** Names the button for screen readers: "Copy {what}". */
	what: string;
	children?: string;
}) {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
	useEffect(() => {
		if (state !== "copied") return;
		const timer = setTimeout(() => setState("idle"), 2000);
		return () => clearTimeout(timer);
	}, [state]);
	return (
		<>
			<ActionButton
				aria-label={FS_COPY.label(what)}
				onClick={() => {
					const clipboard = globalThis.navigator?.clipboard;
					if (!clipboard) {
						setState("failed");
						return;
					}
					clipboard.writeText(text).then(
						() => setState("copied"),
						() => setState("failed"),
					);
				}}
			>
				{state === "copied" ? (
					<Check aria-hidden className="size-3.5" />
				) : (
					<Copy aria-hidden className="size-3.5" />
				)}
				{state === "copied" ? FS_COPY.copied : children}
			</ActionButton>
			{state === "failed" ? (
				<span
					role="alert"
					className="basis-full text-right text-xs text-destructive"
				>
					{FS_COPY.failed}
				</span>
			) : null}
			<span aria-live="polite" className="sr-only">
				{state === "copied" ? FS_COPY.copied : ""}
			</span>
		</>
	);
}
