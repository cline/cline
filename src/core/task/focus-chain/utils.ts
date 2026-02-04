import { isCompletedFocusChainItem, isFocusChainItem } from "@shared/focus-chain-utils"
import { StructuredPlan } from "./types"

export interface TodoListCounts {
	totalItems: number
	completedItems: number
}

/**
 * Parses a focus chain list string and returns counts of total and completed items
 * @param todoList The focus chain list string to parse
 * @returns Object with totalItems and completedItems counts
 */
export function parseFocusChainListCounts(todoList: string): TodoListCounts {
	const lines = todoList.split("\n")
	let totalItems = 0
	let completedItems = 0

	for (const line of lines) {
		const trimmed = line.trim()
		if (isFocusChainItem(trimmed)) {
			totalItems++
			if (isCompletedFocusChainItem(trimmed)) {
				completedItems++
			}
		}
	}

	return { totalItems, completedItems }
}

export function planToMarkdown(plan: StructuredPlan): string {
	return plan.steps.map(step => {
		const check = step.status === 'completed' ? 'x' : ' ';
		return `- [${check}] ${step.description}`;
	}).join('\n');
}

export function tryParseJSON(str: string): any | null {
	try {
		let content = str.trim()
		// Remove markdown code blocks if present
		if (content.startsWith('```')) {
			const lines = content.split('\n')
			// Remove first line (```json or ```)
			lines.shift()
			// Remove last line if it is ```
			if (lines[lines.length - 1].trim() === '```') {
				lines.pop()
			}
			content = lines.join('\n')
		}
		return JSON.parse(content)
	} catch (e) {
		return null
	}
}

