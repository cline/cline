import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import { useCallback } from "react";
import {
	applyReasoningChoice,
	getCurrentReasoningChoice,
	getReasoningChoices,
	type ReasoningChoice,
	type ReasoningModel,
} from "../../utils/reasoning-options";
import type { Config } from "../../utils/types";
import { withLoadingDialog } from "../components/dialogs/loading-dialog";
import { ReasoningLevelContent } from "../components/model-selector/model-selector";

export async function chooseModelReasoning(input: {
	dialog: DialogActions;
	config: Config;
	termHeight: number;
	model?: ReasoningModel;
	modelName: string;
	allowUnknown?: boolean;
	showDefaultOnly?: boolean;
}): Promise<boolean> {
	const levels = getReasoningChoices(input.model, {
		allowUnknown: input.allowUnknown,
	});
	if (levels.length === 1 && !input.showDefaultOnly) {
		applyReasoningChoice(input.config, "default");
		return true;
	}
	const choice = await input.dialog.choice<ReasoningChoice>({
		style: { maxHeight: input.termHeight - 2 },
		content: (ctx: ChoiceContext<ReasoningChoice>) => (
			<ReasoningLevelContent
				{...ctx}
				modelName={input.modelName}
				currentLevel={getCurrentReasoningChoice(input.config)}
				levels={levels}
				manual={
					input.allowUnknown && input.model?.reasoningOptions === undefined
				}
			/>
		),
	});
	if (choice === undefined) return false;
	applyReasoningChoice(input.config, choice);
	return true;
}

export function useReasoningSelector(input: {
	dialog: DialogActions;
	config: Config;
	termHeight: number;
	onModelChange: () => Promise<void>;
	refocusTextarea: () => void;
}) {
	const { dialog, config, termHeight, onModelChange, refocusTextarea } = input;
	return useCallback(async () => {
		try {
			const model = config.knownModels?.[config.modelId];
			const selected = await chooseModelReasoning({
				dialog,
				config,
				termHeight,
				model: model && {
					supportsReasoning: model.capabilities?.some(
						(capability) =>
							capability === "reasoning" || capability === "reasoning-effort",
					),
					reasoningOptions: model.reasoningOptions,
				},
				modelName: model?.name ?? config.modelId,
				allowUnknown: !model || config.providerId === "openai-compatible",
				showDefaultOnly: true,
			});
			if (selected) {
				await withLoadingDialog(
					dialog,
					"Applying reasoning effort...",
					onModelChange,
				);
			}
		} finally {
			refocusTextarea();
		}
	}, [dialog, config, termHeight, onModelChange, refocusTextarea]);
}
