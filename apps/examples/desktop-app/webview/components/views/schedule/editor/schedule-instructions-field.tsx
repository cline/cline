import { FileBrowserContent } from "@cline/ui";
import { useRef } from "react";
import { MemoizedMarkdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { useTextareaAutosize } from "@/hooks/use-textarea-autosize";
import { SCHEDULE_FIELD_IDS } from "./schedule-field-ids";
import styles from "./schedule-instructions-field.module.css";

export function ScheduleInstructionsField({
	value,
	onChange,
	labelId,
	invalid = false,
}: {
	value: string;
	onChange: (value: string) => void;
	labelId: string;
	invalid?: boolean;
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	useTextareaAutosize(inputRef, value);
	return (
		<FileBrowserContent
			aria-labelledby={labelId}
			className={styles.instructions}
			headerLabel="Instructions"
			headerLabelId={labelId}
			sizing="content"
			minBodyHeight="18rem"
			maxBodyHeight="36rem"
			showActions={false}
			defaultMode="source"
			sourceLabel="Edit"
			source={
				<Textarea
					ref={inputRef}
					id={SCHEDULE_FIELD_IDS.prompt}
					aria-labelledby={labelId}
					aria-invalid={invalid || undefined}
					className="h-auto min-h-72 resize-none overflow-hidden rounded-none border-0 bg-transparent p-4 font-mono text-sm leading-relaxed shadow-none focus-visible:ring-inset dark:bg-transparent"
					rows={6}
					value={value}
					onChange={(event) => onChange(event.target.value)}
				/>
			}
			preview={
				value.trim() ? (
					<MemoizedMarkdown classNames="text-sm" content={value} />
				) : (
					<p className="text-muted-foreground text-sm">
						Nothing to preview yet.
					</p>
				)
			}
		/>
	);
}
