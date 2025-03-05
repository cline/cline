import { HTMLAttributes } from "react"
import { VSCodeCheckbox, VSCodeRadio, VSCodeRadioGroup } from "@vscode/webview-ui-toolkit/react"
import { GitBranch } from "lucide-react"

import { CheckpointStorage, isCheckpointStorage } from "../../../../src/shared/checkpoints"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type CheckpointSettingsProps = HTMLAttributes<HTMLDivElement> & {
	enableCheckpoints?: boolean
	checkpointStorage?: CheckpointStorage
	setCachedStateField: SetCachedStateField<"enableCheckpoints" | "checkpointStorage">
}

export const CheckpointSettings = ({
	enableCheckpoints,
	checkpointStorage = "task",
	setCachedStateField,
	...props
}: CheckpointSettingsProps) => {
	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<GitBranch className="w-4" />
					<div>Checkpoints</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={enableCheckpoints}
						onChange={(e: any) => {
							setCachedStateField("enableCheckpoints", e.target.checked)
						}}>
						<span className="font-medium">Enable automatic checkpoints</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						When enabled, Roo will automatically create checkpoints during task execution, making it easy to
						review changes or revert to earlier states.
					</p>
					{enableCheckpoints && (
						<div>
							<div className="font-medium">Storage</div>
							<VSCodeRadioGroup
								role="radiogroup"
								value={checkpointStorage}
								onChange={(e) => {
									if ("target" in e) {
										const { value } = e.target as HTMLInputElement

										if (isCheckpointStorage(value)) {
											setCachedStateField("checkpointStorage", value)
										}
									}
								}}>
								<VSCodeRadio value="task">Task</VSCodeRadio>
								<VSCodeRadio value="workspace">Workspace</VSCodeRadio>
							</VSCodeRadioGroup>
							{checkpointStorage === "task" && (
								<p className="text-vscode-descriptionForeground text-sm mt-0">
									Each task will have it's own dedicated git repository for storing checkpoints. This
									provides the best isolation between tasks but uses more disk space.
								</p>
							)}
							{checkpointStorage === "workspace" && (
								<p className="text-vscode-descriptionForeground text-sm mt-0">
									Each VSCode workspace will have it's own dedicated git repository for storing
									checkpoints and tasks within a workspace will share this repository. This option
									provides better performance and disk space efficiency.
								</p>
							)}
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}
