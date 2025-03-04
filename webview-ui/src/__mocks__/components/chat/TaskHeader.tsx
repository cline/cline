import React from "react"
// Import the actual utility instead of reimplementing it
import { getMaxTokensForModel } from "@/utils/model-utils"

// Re-export the utility function to maintain the same interface
export { getMaxTokensForModel }

/**
 * Mock version of the TaskHeader component
 */
const TaskHeader: React.FC<any> = () => {
	return <div data-testid="mocked-task-header">Mocked TaskHeader</div>
}

export default TaskHeader
