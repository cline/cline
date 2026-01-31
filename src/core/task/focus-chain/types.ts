export interface PlanStep {
	id: string
	description: string
	status: "pending" | "in_progress" | "completed" | "failed"
}

export type EvaluatorDecision = "continue" | "replan" | "stop"

export interface EvaluatorSignals {
	decision: EvaluatorDecision
	reasoning: string
	confidence?: number
}

export interface StructuredPlan {
	steps: PlanStep[]
}
