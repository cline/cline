import { DetailListItem } from "@cline/ui";
import { BrainCircuit } from "lucide-react";
import { useCallback } from "react";
import { DraftModelSelector } from "@/components/model-selector";
import type { ScheduleEditor } from "./use-schedule-editor";

export function ScheduleModelFields({
	editor,
	disabled = false,
}: {
	editor: ScheduleEditor;
	disabled?: boolean;
}) {
	const { form, setForm, isSaving } = editor;
	const setProvider = useCallback(
		(provider: string) => setForm((current) => ({ ...current, provider })),
		[setForm],
	);
	const setModel = useCallback(
		(model: string) => setForm((current) => ({ ...current, model })),
		[setForm],
	);
	return (
		<DetailListItem
			leadingIcon={BrainCircuit}
			title="Provider & model"
			actions={
				<DraftModelSelector
					className="max-w-full"
					isBusy={isSaving || disabled}
					model={form.model}
					onModelChange={setModel}
					onProviderChange={setProvider}
					placement="bottom"
					provider={form.provider}
				/>
			}
		/>
	);
}
