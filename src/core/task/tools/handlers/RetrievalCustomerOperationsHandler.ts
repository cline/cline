import type { ToolUse } from "@core/assistant-message"
import { ClineDefaultTool } from "@shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

/**
 * Handler for retrieving customer connector operations
 * Returns a default list of customer connectors for MuleSoft flow generation
 */
export class RetrievalCustomerOperationsHandler implements IToolHandler {
	readonly name = ClineDefaultTool.RETRIEVE_CUSTOMER_OPS

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const { query } = block.params as { query?: string }

		// Default list of customer operations
		const customerOperations = [
			"customer_connector_1",
			"customer_connector_2",
			"customer_connector_3",
		]

		// Filter operations based on query if provided
		const filteredOps = query
			? customerOperations.filter((op) => op.toLowerCase().includes(query.toLowerCase()))
			: customerOperations

		// Format the result
		const result = `Available customer connector operations:\n${filteredOps.map((op) => `- ${op}`).join("\n")}\n\nTotal: ${filteredOps.length} operation(s) found${query ? ` matching "${query}"` : ""}.`

		return result
	}

	getDescription(block: ToolUse): string {
		const { query } = block.params as { query?: string }
		return query
			? `Retrieving customer operations matching "${query}"...`
			: "Retrieving available customer operations..."
	}
}

