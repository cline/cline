import type { GlobalSettings } from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import { Button, StandardTooltip } from "@/components/ui"

type AutoApproveToggles = Pick<
	GlobalSettings,
	| "alwaysAllowReadOnly"
	| "alwaysAllowWrite"
	| "alwaysAllowBrowser"
	| "alwaysApproveResubmit"
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "alwaysAllowSubtasks"
	| "alwaysAllowExecute"
	| "alwaysAllowFollowupQuestions"
	| "alwaysAllowUpdateTodoList"
>

export type AutoApproveSetting = keyof AutoApproveToggles

type AutoApproveConfig = {
	key: AutoApproveSetting
	labelKey: string
	descriptionKey: string
	icon: string
	testId: string
}

export const autoApproveSettingsConfig: Record<AutoApproveSetting, AutoApproveConfig> = {
	alwaysAllowReadOnly: {
		key: "alwaysAllowReadOnly",
		labelKey: "settings:autoApprove.readOnly.label",
		descriptionKey: "settings:autoApprove.readOnly.description",
		icon: "eye",
		testId: "always-allow-readonly-toggle",
	},
	alwaysAllowWrite: {
		key: "alwaysAllowWrite",
		labelKey: "settings:autoApprove.write.label",
		descriptionKey: "settings:autoApprove.write.description",
		icon: "edit",
		testId: "always-allow-write-toggle",
	},
	alwaysAllowBrowser: {
		key: "alwaysAllowBrowser",
		labelKey: "settings:autoApprove.browser.label",
		descriptionKey: "settings:autoApprove.browser.description",
		icon: "globe",
		testId: "always-allow-browser-toggle",
	},
	alwaysApproveResubmit: {
		key: "alwaysApproveResubmit",
		labelKey: "settings:autoApprove.retry.label",
		descriptionKey: "settings:autoApprove.retry.description",
		icon: "refresh",
		testId: "always-approve-resubmit-toggle",
	},
	alwaysAllowMcp: {
		key: "alwaysAllowMcp",
		labelKey: "settings:autoApprove.mcp.label",
		descriptionKey: "settings:autoApprove.mcp.description",
		icon: "plug",
		testId: "always-allow-mcp-toggle",
	},
	alwaysAllowModeSwitch: {
		key: "alwaysAllowModeSwitch",
		labelKey: "settings:autoApprove.modeSwitch.label",
		descriptionKey: "settings:autoApprove.modeSwitch.description",
		icon: "sync",
		testId: "always-allow-mode-switch-toggle",
	},
	alwaysAllowSubtasks: {
		key: "alwaysAllowSubtasks",
		labelKey: "settings:autoApprove.subtasks.label",
		descriptionKey: "settings:autoApprove.subtasks.description",
		icon: "list-tree",
		testId: "always-allow-subtasks-toggle",
	},
	alwaysAllowExecute: {
		key: "alwaysAllowExecute",
		labelKey: "settings:autoApprove.execute.label",
		descriptionKey: "settings:autoApprove.execute.description",
		icon: "terminal",
		testId: "always-allow-execute-toggle",
	},
	alwaysAllowFollowupQuestions: {
		key: "alwaysAllowFollowupQuestions",
		labelKey: "settings:autoApprove.followupQuestions.label",
		descriptionKey: "settings:autoApprove.followupQuestions.description",
		icon: "question",
		testId: "always-allow-followup-questions-toggle",
	},
	alwaysAllowUpdateTodoList: {
		key: "alwaysAllowUpdateTodoList",
		labelKey: "settings:autoApprove.updateTodoList.label",
		descriptionKey: "settings:autoApprove.updateTodoList.description",
		icon: "checklist",
		testId: "always-allow-update-todo-list-toggle",
	},
}

type AutoApproveToggleProps = AutoApproveToggles & {
	onToggle: (key: AutoApproveSetting, value: boolean) => void
}

export const AutoApproveToggle = ({ onToggle, ...props }: AutoApproveToggleProps) => {
	const { t } = useAppTranslation()

	return (
		<div
			className={cn(
				"flex flex-row flex-wrap justify-center gap-2 max-w-[600px] mx-auto my-2 ",
				"[@media(min-width:600px)]:gap-4",
				"[@media(min-width:800px)]:max-w-[900px]",
				"[@media(min-width:1200px)]:max-w-[1800px]",
			)}>
			{Object.values(autoApproveSettingsConfig).map(({ key, descriptionKey, labelKey, icon, testId }) => (
				<StandardTooltip key={key} content={t(descriptionKey || "")}>
					<Button
						variant={props[key] ? "default" : "outline"}
						onClick={() => onToggle(key, !props[key])}
						aria-label={t(labelKey)}
						aria-pressed={!!props[key]}
						data-testid={testId}
						className={cn(" aspect-square h-[80px]", !props[key] && "opacity-50")}>
						<span className={cn("flex flex-col items-center gap-1")}>
							<span className={`codicon codicon-${icon}`} />
							<span className="text-sm text-center">{t(labelKey)}</span>
						</span>
					</Button>
				</StandardTooltip>
			))}
		</div>
	)
}
