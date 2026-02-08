export interface PlanStep {
    id: string
    description: string
    status: 'pending' | 'in_progress' | 'completed' | 'failed'
}

export interface StructuredPlan {
    steps: PlanStep[]
}
