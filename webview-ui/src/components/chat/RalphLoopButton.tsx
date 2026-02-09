/**
 * RalphLoopButton - Toolbar button to launch the Ralph Loop configuration modal.
 *
 * Renders a small button in the ChatTextArea toolbar. When clicked, opens the
 * RalphLoopModal wizard. On start, sends a startBeadTask gRPC request.
 */

import { StartBeadTaskRequest, SuccessCriterion, SuccessCriterionType } from "@shared/proto/beadsmith/bead"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { RepeatIcon } from "lucide-react"
import React, { useCallback, useState } from "react"
import { type PlanStep, type RalphLoopConfig, RalphLoopModal } from "@/components/ralph"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BeadServiceClient } from "@/services/grpc-client"

const RalphLoopButton: React.FC = () => {
	const { beadsEnabled } = useExtensionState()
	const [isModalOpen, setIsModalOpen] = useState(false)

	const handleStart = useCallback((config: RalphLoopConfig, _plan: PlanStep[]) => {
		const criteria: SuccessCriterion[] = []

		// Add done_tag criterion (always — the completion signal)
		criteria.push(
			SuccessCriterion.create({
				type: SuccessCriterionType.SUCCESS_CRITERION_DONE_TAG,
			}),
		)

		// Add tests_pass criterion if a test command is configured
		if (config.testCommand) {
			criteria.push(
				SuccessCriterion.create({
					type: SuccessCriterionType.SUCCESS_CRITERION_TESTS_PASS,
				}),
			)
		}

		const request = StartBeadTaskRequest.create({
			description: config.taskDescription,
			successCriteria: criteria,
			maxIterations: config.maxIterations,
			testCommand: config.testCommand || undefined,
		})

		BeadServiceClient.startBeadTask(request).catch((error) => {
			console.error("[RalphLoopButton] Failed to start bead task:", error)
		})
	}, [])

	if (!beadsEnabled) {
		return null
	}

	return (
		<>
			<Tooltip>
				<TooltipContent>Start Ralph Loop</TooltipContent>
				<TooltipTrigger>
					<VSCodeButton
						appearance="icon"
						aria-label="Start Ralph Loop"
						className="p-0 m-0 flex items-center"
						onClick={() => setIsModalOpen(true)}>
						<div className="flex items-center justify-center size-[18px]">
							<RepeatIcon size={12} />
						</div>
					</VSCodeButton>
				</TooltipTrigger>
			</Tooltip>

			<RalphLoopModal isVisible={isModalOpen} onClose={() => setIsModalOpen(false)} onStart={handleStart} />
		</>
	)
}

export default RalphLoopButton
