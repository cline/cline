import { Button, DetailListItem } from "@cline/ui";
import { Folder } from "lucide-react";
import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useAsyncAction } from "@/hooks/use-async-action";
import { useTextareaAutosize } from "@/hooks/use-textarea-autosize";
import { desktopClient } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";
import styles from "../../shared/form-controls.module.css";
import { SCHEDULE_FIELD_IDS } from "./schedule-field-ids";

const DESCRIPTION_ID = `${SCHEDULE_FIELD_IDS.workspace}-description`;
const ERROR_ID = `${SCHEDULE_FIELD_IDS.workspace}-error`;
const PLACEHOLDER = "/path/to/project";
/** Width in characters where the field cannot size itself to its content. */
const FALLBACK_COLUMNS = { min: PLACEHOLDER.length + 2, max: 56 };

export function ScheduleWorkspaceField({
	value,
	onChange,
	disabled = false,
	invalid = false,
}: {
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	invalid?: boolean;
}) {
	const { pending: isPicking, run } = useAsyncAction();
	const [pickerError, setPickerError] = useState<string | null>(null);
	const disabledRef = useRef(disabled);
	disabledRef.current = disabled;
	const inputRef = useRef<HTMLTextAreaElement>(null);
	useTextareaAutosize(inputRef, value);

	const pickFolder = async () => {
		if (disabledRef.current) return;
		await run(
			() => {
				setPickerError(null);
				return desktopClient.invoke<string | null>("pick_workspace_directory", {
					initialPath: value.trim() || undefined,
				});
			},
			{
				onSuccess: (selected) => {
					if (!disabledRef.current && selected?.trim()) {
						onChange(selected.trim());
					}
				},
				onError: () => {
					if (!disabledRef.current) {
						setPickerError(
							"Could not open the folder picker. Enter a folder path instead.",
						);
					}
				},
			},
		);
	};

	return (
		<DetailListItem
			leadingIcon={Folder}
			title={
				<label htmlFor={SCHEDULE_FIELD_IDS.workspace}>Project folder</label>
			}
			description={
				<span id={DESCRIPTION_ID}>
					Runs in this folder and uses its project settings.
				</span>
			}
			actions={
				<div className="w-max max-w-full space-y-2">
					<div className="flex min-w-0 items-center gap-2">
						{/* A textarea so a long path wraps into view; it still behaves
						    as one line: no line breaks, and Enter submits the form. */}
						<Textarea
							ref={inputRef}
							id={SCHEDULE_FIELD_IDS.workspace}
							aria-describedby={
								pickerError ? `${DESCRIPTION_ID} ${ERROR_ID}` : DESCRIPTION_ID
							}
							aria-invalid={invalid || undefined}
							className={cn(
								styles.control,
								"min-h-8 w-auto min-w-0 flex-auto resize-none overflow-hidden py-1.5 wrap-anywhere",
							)}
							rows={1}
							cols={Math.min(
								Math.max(value.length + 2, FALLBACK_COLUMNS.min),
								FALLBACK_COLUMNS.max,
							)}
							wrap="soft"
							spellCheck={false}
							autoCapitalize="none"
							disabled={disabled || isPicking}
							required
							value={value}
							onKeyDown={(event) => {
								if (event.key !== "Enter" || event.nativeEvent.isComposing)
									return;
								event.preventDefault();
								event.currentTarget.form?.requestSubmit();
							}}
							onChange={(event) => {
								setPickerError(null);
								onChange(event.target.value.replace(/[\r\n]+/g, ""));
							}}
							placeholder={PLACEHOLDER}
						/>
						<Button
							type="button"
							variant="secondary"
							tone="neutral"
							size="sm"
							aria-label="Browse for project folder…"
							aria-busy={isPicking}
							disabled={disabled || isPicking}
							onClick={() => void pickFolder()}
						>
							Browse…
						</Button>
					</div>
					{pickerError && (
						<p
							id={ERROR_ID}
							role="alert"
							className="text-left text-destructive text-sm"
						>
							{pickerError}
						</p>
					)}
				</div>
			}
		/>
	);
}
