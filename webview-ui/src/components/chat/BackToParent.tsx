import SuccessButton from "@/components/common/SuccessButton"
import { TaskServiceClient } from "@/services/grpc-client"
import { StringRequest } from "@shared/proto/common"
import { useExtensionState } from "@/context/ExtensionStateContext"

const headerStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "10px",
	marginBottom: "12px",
}
export default function BackToParent() {
	const { currentTaskItem } = useExtensionState()
	return (
		currentTaskItem?.parentId && (
			<>
				<div
					style={{
						...headerStyle,
						marginBottom: "10px",
					}}>
					<div style={{ marginTop: 10 }}>
						<SuccessButton
							appearance="secondary"
							onClick={() => {
								TaskServiceClient.showTaskWithId(
									StringRequest.create({
										value: currentTaskItem.parentId,
									}),
								).catch((err) => console.error("Failed to resume task:", err))
							}}>
							<span className="codicon codicon-arrow-left" style={{ marginRight: 6 }} />
							Back to parent Task
						</SuccessButton>
					</div>
				</div>
			</>
		)
	)
}
