import type { BankSnapshot } from "@cline/shared";

/** Collapse when no active plan / no open tasks. */
export function shouldShowNowNext(snapshot: BankSnapshot): boolean {
	return Boolean(snapshot.activePlanId && snapshot.nowTaskId);
}
