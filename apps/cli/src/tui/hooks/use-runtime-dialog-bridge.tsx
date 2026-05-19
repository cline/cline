import type { AgentMode } from "@cline/core";
import { useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialog } from "@opentui-ui/dialog/react";
import { useEffect } from "react";
import { AskQuestionContent } from "../components/dialogs/ask-question";
import { ToolApprovalContent } from "../components/dialogs/tool-approval";
import type { TuiProps } from "../types";

export function useRuntimeDialogBridge(input: {
	setToolApprover: TuiProps["setToolApprover"];
	setAskQuestion: TuiProps["setAskQuestion"];
	setModeChangeNotifier: TuiProps["setModeChangeNotifier"];
	setUiMode: (mode: AgentMode) => void;
	refocusTextarea: () => void;
}) {
	const dialog = useDialog();
	const { height: termHeight } = useTerminalDimensions();
	const {
		setToolApprover,
		setAskQuestion,
		setModeChangeNotifier,
		setUiMode,
		refocusTextarea,
	} = input;

	useEffect(() => {
		setToolApprover(async (request) => {
			const approved = await dialog.choice<boolean>({
				style: { maxHeight: termHeight - 2 },
				closeOnEscape: false,
				content: (ctx: ChoiceContext<boolean>) => (
					<ToolApprovalContent {...ctx} request={request} />
				),
			});
			if (approved) {
				return { approved: true };
			}
			return {
				approved: false,
				reason: `Tool "${request.toolName}" was denied by user`,
			};
		});
		setAskQuestion(async (question, options) => {
			const answer = await dialog.choice<string | null>({
				style: { maxHeight: termHeight - 2 },
				closeOnEscape: false,
				content: (ctx: ChoiceContext<string | null>) => (
					<AskQuestionContent {...ctx} question={question} options={options} />
				),
			});
			refocusTextarea();
			if (answer === null) {
				return "[User dismissed the question]";
			}
			return answer ?? options[0] ?? "";
		});
		setModeChangeNotifier((mode) => {
			setUiMode(mode);
		});
		return () => {
			setToolApprover(null);
			setAskQuestion(null);
			setModeChangeNotifier(null);
		};
	}, [
		dialog,
		refocusTextarea,
		setAskQuestion,
		setModeChangeNotifier,
		setToolApprover,
		setUiMode,
		termHeight,
	]);
}
