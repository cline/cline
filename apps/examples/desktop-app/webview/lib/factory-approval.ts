import type { FactoryPlanApprovalInput } from "@cline/shared";
import { factoryPlanApprovalBlocker } from "@cline/shared/browser";

/** A saved plan whose scoping has settled and that core would approve now. */
export function factoryPlanReady(task: FactoryPlanApprovalInput): boolean {
	const design =
		task.factoryDesignProgress?.revision === task.revision
			? task.factoryDesignProgress
			: undefined;
	return (
		(!design || design.phase === "complete") &&
		!factoryPlanApprovalBlocker(task)
	);
}
