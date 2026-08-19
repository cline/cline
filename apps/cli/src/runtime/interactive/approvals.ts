import type { ToolApprovalRequest, ToolApprovalResult } from "@cline/shared";
import type { Config } from "../../utils/types";
import {
	applyInteractiveAutoApproveOverride,
	cloneToolPolicies,
	resolveInteractiveAutoApprovePolicy,
} from "../tool-policies";

export interface InteractiveRuntimeRefs {
	tuiToolApprover: {
		current:
			| ((request: ToolApprovalRequest) => Promise<ToolApprovalResult>)
			| null;
	};
	tuiAskQuestion: {
		current: ((question: string, options: string[]) => Promise<string>) | null;
	};
}

export function createInteractiveApprovalController(config: Config) {
	const autoApproveAllRef = {
		current: config.toolPolicies["*"]?.autoApprove !== false,
	};
	const baselineToolPolicies = cloneToolPolicies(config.toolPolicies);
	const refs: InteractiveRuntimeRefs = {
		tuiToolApprover: { current: null },
		tuiAskQuestion: { current: null },
	};

	const setInteractiveAutoApprove = (enabled: boolean) => {
		autoApproveAllRef.current = enabled;
		applyInteractiveAutoApproveOverride({
			targetPolicies: config.toolPolicies,
			baselinePolicies: baselineToolPolicies,
			enabled,
		});
	};

	const requestToolApproval = async (
		request: ToolApprovalRequest,
	): Promise<ToolApprovalResult> => {
		if (autoApproveAllRef.current) {
			return { approved: true };
		}
		if (request.policy?.autoApprove === true) {
			return { approved: true };
		}
		if (refs.tuiToolApprover.current) {
			return refs.tuiToolApprover.current(request);
		}
		return { approved: false };
	};

	return {
		autoApproveAllRef,
		setInteractiveAutoApprove,
		requestToolApproval,
		resolveToolPolicy: (toolName: string) =>
			resolveInteractiveAutoApprovePolicy({
				toolName,
				baselinePolicies: baselineToolPolicies,
				enabled: autoApproveAllRef.current,
			}),
		...refs,
	};
}
