import * as fs from "fs"
import * as path from "path"

export interface ParsedRule {
	name: string
	description: string
	reasoning: string
}

export interface ParsedSubstep {
	id: string
	text: string
	completed: boolean
}

export interface ParsedStep {
	id: string
	type: string
	title: string
	description: string
	status: "pending" | "in_progress" | "completed" | "blocked"
	beforeStarting?: string
	rules: ParsedRule[]
	substeps: ParsedSubstep[]
	afterCompleting?: string
	notes: string[]
}

export interface ParsedPlan {
	chatId: string
	title: string
	createdAt: string
	updatedAt: string
	steps: ParsedStep[]
}

export class ZoroPlanParser {
	static parsePlan(workspaceRoot: string): ParsedPlan | null {
		const planPath = path.join(workspaceRoot, ".clinerules", "zoro_plan.md")

		if (!fs.existsSync(planPath)) {
			return null
		}

		const content = fs.readFileSync(planPath, "utf-8")
		return this.parseMarkdown(content)
	}

	private static parseMarkdown(content: string): ParsedPlan {
		const lines = content.split("\n")

		const titleMatch = content.match(/# Plan: (.+?) \((.+?)\)/)
		const title = titleMatch?.[1] || "Unknown Plan"
		const chatId = titleMatch?.[2] || "unknown"

		const createdMatch = content.match(/\*\*Created:\*\* (.+)/)
		const updatedMatch = content.match(/\*\*Updated:\*\* (.+)/)
		const createdAt = createdMatch?.[1] || ""
		const updatedAt = updatedMatch?.[1] || ""

		const steps: ParsedStep[] = []
		const stepRegex = /^### (step-\d+): \[(.+?)\] (.+)/

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			const match = line.match(stepRegex)

			if (match) {
				const stepId = match[1]
				const stepType = match[2]
				const stepTitle = match[3]

				const step = this.parseStep(lines, i, stepId, stepType, stepTitle)
				steps.push(step)
			}
		}

		return {
			chatId,
			title,
			createdAt,
			updatedAt,
			steps,
		}
	}

	private static parseStep(
		lines: string[],
		startIdx: number,
		id: string,
		type: string,
		title: string
	): ParsedStep {
		const step: ParsedStep = {
			id,
			type,
			title,
			description: "",
			status: "pending",
			rules: [],
			substeps: [],
			notes: [],
		}

		let endIdx = lines.length
		for (let i = startIdx + 1; i < lines.length; i++) {
			if (lines[i].startsWith("### step-")) {
				endIdx = i
				break
			}
		}

		let currentSection = ""
		let descriptionLines: string[] = []
		let inRules = false
		let inSubsteps = false
		let inNotes = false

		for (let i = startIdx + 1; i < endIdx; i++) {
			const line = lines[i].trim()

			if (line.startsWith("**Status:**")) {
				const statusMatch = line.match(/\*\*Status:\*\* (.+)/)
				if (statusMatch) {
					step.status = statusMatch[1] as any
				}
				continue
			}

			if (line.startsWith("**Before Starting:**")) {
				currentSection = "beforeStarting"
				continue
			}

			if (line.startsWith("**After Completing:**")) {
				currentSection = "afterCompleting"
				continue
			}

			if (line.startsWith("**Rules to follow:**")) {
				inRules = true
				inSubsteps = false
				inNotes = false
				continue
			}

			if (line.startsWith("**Substeps:**")) {
				inSubsteps = true
				inRules = false
				inNotes = false
				continue
			}

			if (line.startsWith("**Notes:**")) {
				inNotes = true
				inRules = false
				inSubsteps = false
				continue
			}

			if (inRules && line.startsWith("- **[")) {
				const ruleMatch = line.match(/- \*\*\[(.+?)\]\*\* \[.+?\] (.+)/)
				if (ruleMatch) {
					const ruleType = ruleMatch[1]
					const ruleDesc = ruleMatch[2]

					const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : ""
					const reasoningMatch = nextLine.match(/Reasoning: (.+)/)
					const reasoning = reasoningMatch ? reasoningMatch[1] : ""

					step.rules.push({
						name: `[${ruleType}]`,
						description: ruleDesc,
						reasoning,
					})

					if (reasoningMatch) i++
				}
				continue
			}

			if (inSubsteps && (line.startsWith("- \\[x\\]") || line.startsWith("- \\[ \\]"))) {
				const completed = line.startsWith("- \\[x\\]")
				const substepMatch = line.match(/\((.+?)\) (.+)/)
				if (substepMatch) {
					step.substeps.push({
						id: substepMatch[1],
						text: substepMatch[2],
						completed,
					})
				}
				continue
			}

			if (inNotes && line.startsWith("- ")) {
				step.notes.push(line.substring(2))
				continue
			}

			if (!inRules && !inSubsteps && !inNotes && currentSection === "" && line && !line.startsWith("**")) {
				descriptionLines.push(line)
			}

			if (currentSection === "beforeStarting" && line && !line.startsWith("**")) {
				step.beforeStarting = (step.beforeStarting || "") + line + "\n"
			}

			if (currentSection === "afterCompleting" && line && !line.startsWith("**")) {
				step.afterCompleting = (step.afterCompleting || "") + line + "\n"
			}
		}

		step.description = descriptionLines.join("\n").trim()

		return step
	}

	static getStep(workspaceRoot: string, stepId: string): ParsedStep | null {
		const plan = this.parsePlan(workspaceRoot)
		if (!plan) return null

		return plan.steps.find((s) => s.id === stepId) || null
	}

	static getCurrentStep(workspaceRoot: string): ParsedStep | null {
		const plan = this.parsePlan(workspaceRoot)
		if (!plan) return null

		const inProgress = plan.steps.find((s) => s.status === "in_progress")
		if (inProgress) return inProgress

		return plan.steps.find((s) => s.status === "pending") || null
	}
}
