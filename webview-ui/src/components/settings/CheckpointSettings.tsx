import { HTMLAttributes } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { GitBranch } from "lucide-react"

import { CheckpointStorage } from "../../../../src/shared/checkpoints"

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
				</div>
			</Section>
		</div>
	)
}
