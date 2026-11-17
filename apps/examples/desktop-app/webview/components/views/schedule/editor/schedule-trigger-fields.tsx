import { Button, DetailListItem } from "@cline/ui";
import { Clock3 } from "lucide-react";
import { useId } from "react";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	formatScheduleTimezone,
	routineScheduleTimezone,
} from "@/lib/routine-schedule-timezone";
import { cn } from "@/lib/utils";
import styles from "../../shared/form-controls.module.css";
import {
	buildRunAt,
	formatScheduleDays,
	hasCustomScheduleTiming,
	minimumOneTimeDateTime,
	normalizeScheduleDays,
	WEEKDAY_OPTIONS,
} from "../schedule-format";
import { formatScheduleNextRun } from "../schedule-list-format";
import { SCHEDULE_FIELD_IDS } from "./schedule-field-ids";
import triggerStyles from "./schedule-trigger-fields.module.css";
import type { ScheduleEditor } from "./use-schedule-editor";

function nextRunSummary(editor: ScheduleEditor): string | null {
	const schedule = editor.persistedSchedule;
	// A draft with different timing would make the saved time misleading.
	if (!schedule || editor.hasUnsavedTimingChanges) return null;
	if (!schedule.enabled) return null;
	const nextRun = formatScheduleNextRun(schedule);
	return nextRun === "—" ? null : `Next run: ${nextRun}`;
}

export function ScheduleTriggerFields({
	editor,
	disabled = false,
}: {
	editor: ScheduleEditor;
	disabled?: boolean;
}) {
	const { form, setForm, editingSchedule, validation } = editor;
	const minimumOnce = minimumOneTimeDateTime();
	const timezoneDescriptionId = useId();
	const daysLabelId = useId();
	const daysValueId = useId();
	const timezone =
		form.scheduleType === "once"
			? Intl.DateTimeFormat().resolvedOptions().timeZone
			: routineScheduleTimezone(form.scheduleType, editingSchedule);
	const customCron =
		editingSchedule && hasCustomScheduleTiming(editingSchedule.cronPattern)
			? editingSchedule.cronPattern
			: null;
	const nextRun = nextRunSummary(editor);
	const isDateInvalid = validation?.field === "date";
	return (
		<DetailListItem
			leadingIcon={Clock3}
			title="Frequency"
			description={
				nextRun || customCron ? (
					<div className="space-y-0.5 text-xs">
						{nextRun ? <p>{nextRun}</p> : null}
						{customCron ? (
							<p>
								This schedule uses custom timing (
								<code className="break-all text-foreground">{customCron}</code>
								). Changing these controls will replace it.
							</p>
						) : null}
					</div>
				) : undefined
			}
			actions={
				<div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-foreground">
					<div className="min-w-0 w-36">
						<Label className="sr-only" htmlFor={SCHEDULE_FIELD_IDS.type}>
							Frequency
						</Label>
						<Select
							disabled={disabled}
							onValueChange={(value) =>
								setForm((prev) => ({
									...prev,
									scheduleType:
										value === "once" || value === "daily" ? value : "weekly",
								}))
							}
							value={form.scheduleType}
						>
							<SelectTrigger
								className={cn(styles.control, "w-full")}
								id={SCHEDULE_FIELD_IDS.type}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="daily" disabled={disabled}>
									Every day
								</SelectItem>
								<SelectItem value="weekly" disabled={disabled}>
									Every week
								</SelectItem>
								<SelectItem value="once" disabled={disabled}>
									Once
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{form.scheduleType === "once" && (
						<div className="min-w-0 w-40">
							<Label className="sr-only" htmlFor={SCHEDULE_FIELD_IDS.date}>
								Date
							</Label>
							{/* `min` guides the native picker. Typed values are checked on
							    save: correcting them per keystroke rewrites partial input. */}
							<Input
								aria-invalid={isDateInvalid || undefined}
								className={styles.control}
								id={SCHEDULE_FIELD_IDS.date}
								min={minimumOnce.date}
								onChange={(event) =>
									setForm((prev) => ({
										...prev,
										scheduleDate: event.target.value,
									}))
								}
								type="date"
								value={form.scheduleDate}
							/>
						</div>
					)}
					{form.scheduleType === "weekly" && (
						<div className="min-w-0 w-44">
							<span id={daysLabelId} className="sr-only">
								Days
							</span>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										id={SCHEDULE_FIELD_IDS.days}
										aria-labelledby={`${daysLabelId} ${daysValueId}`}
										aria-invalid={validation?.field === "days" || undefined}
										className={cn(styles.control, "w-full justify-between")}
										variant="secondary"
										tone="neutral"
										size="md"
										pressScale={false}
									>
										<span id={daysValueId} className="truncate">
											{formatScheduleDays(form.scheduleDays) || "Choose days"}
										</span>
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start" className="w-48">
									{WEEKDAY_OPTIONS.map((day) => (
										<DropdownMenuCheckboxItem
											disabled={disabled}
											checked={form.scheduleDays.includes(day.value)}
											key={day.value}
											onCheckedChange={(checked) =>
												setForm((prev) => {
													const days = new Set(prev.scheduleDays);
													if (checked) days.add(day.value);
													else days.delete(day.value);
													return {
														...prev,
														scheduleDays: normalizeScheduleDays([...days]),
													};
												})
											}
											onSelect={(event) => event.preventDefault()}
										>
											{day.label}
										</DropdownMenuCheckboxItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					)}
					<div className="flex min-w-0 shrink-0 items-baseline gap-2">
						<div className="min-w-0 shrink-0">
							<Label className="sr-only" htmlFor={SCHEDULE_FIELD_IDS.time}>
								Time
							</Label>
							<Input
								aria-describedby={timezoneDescriptionId}
								aria-invalid={isDateInvalid || undefined}
								className={cn(
									styles.control,
									triggerStyles.time,
									"w-auto tabular-nums",
								)}
								id={SCHEDULE_FIELD_IDS.time}
								min={
									form.scheduleType === "once" &&
									form.scheduleDate === minimumOnce.date
										? minimumOnce.time
										: undefined
								}
								onChange={(event) => {
									const [hour, minute] = event.target.value.split(":");
									if (hour !== undefined && minute !== undefined) {
										setForm((prev) => ({
											...prev,
											scheduleHour: String(Number.parseInt(hour, 10)),
											scheduleMinute: String(Number.parseInt(minute, 10)),
										}));
									}
								}}
								type="time"
								value={`${form.scheduleHour.padStart(2, "0")}:${form.scheduleMinute.padStart(2, "0")}`}
							/>
						</div>
						<p
							className="shrink-0 text-muted-foreground text-xs"
							id={timezoneDescriptionId}
						>
							{formatScheduleTimezone(
								timezone,
								form.scheduleType === "once" ? buildRunAt(form) : undefined,
							) || "Local time on the computer running this schedule"}
						</p>
					</div>
				</div>
			}
		/>
	);
}
