import type {
	RuntimeCapabilities,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/core";

type QuickPickOptions = {
	placeHolder?: string;
	ignoreFocusOut?: boolean;
};

type InputBoxOptions = {
	prompt?: string;
	ignoreFocusOut?: boolean;
};

type WarningMessageOptions = {
	modal?: boolean;
	detail?: string;
};

export type VsCodeCapabilityUi = {
	showQuickPick: (
		items: string[],
		options?: QuickPickOptions,
	) => Thenable<string | undefined> | Promise<string | undefined>;
	showInputBox: (
		options?: InputBoxOptions,
	) => Thenable<string | undefined> | Promise<string | undefined>;
	showWarningMessage: <T extends string>(
		message: string,
		options: WarningMessageOptions,
		...items: T[]
	) => Thenable<T | undefined> | Promise<T | undefined>;
};

function stringifyContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (value == null) return "";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function stringifyApprovalInput(input: unknown): string | undefined {
	const text = stringifyContent(input).trim();
	return text.length > 0 ? text : undefined;
}

export function createVsCodeRuntimeCapabilities(options: {
	ui: VsCodeCapabilityUi;
}): RuntimeCapabilities {
	const { ui } = options;
	const askQuestion = async (
		question: string,
		answerOptions?: string[],
	): Promise<string> => {
		const choices = (answerOptions ?? []).filter(
			(option) => option.trim().length > 0,
		);
		if (choices.length > 0) {
			const selected = await ui.showQuickPick(choices, {
				placeHolder: question,
				ignoreFocusOut: true,
			});
			return selected ?? "";
		}
		return (
			(await ui.showInputBox({
				prompt: question,
				ignoreFocusOut: true,
			})) ?? ""
		);
	};

	const requestToolApproval = async (
		request: ToolApprovalRequest,
	): Promise<ToolApprovalResult> => {
		const approve = "Approve";
		const deny = "Deny";
		const inputPreview = stringifyApprovalInput(request.input);
		const selected = await ui.showWarningMessage(
			`Allow ${request.toolName} to run?`,
			{
				modal: true,
				detail: inputPreview
					? `Tool call: ${request.toolCallId}\n${inputPreview}`
					: `Tool call: ${request.toolCallId}`,
			},
			approve,
			deny,
		);
		return selected === approve
			? { approved: true }
			: { approved: false, reason: "Denied by VS Code user" };
	};

	return {
		toolExecutors: {
			askQuestion,
		},
		requestToolApproval,
	};
}
