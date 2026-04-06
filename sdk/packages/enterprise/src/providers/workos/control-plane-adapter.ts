import type {
	EnterpriseConfigBundle,
	EnterpriseControlPlane,
	EnterpriseControlPlaneFetchInput,
} from "../../contracts";

export function createWorkosControlPlaneAdapter(input: {
	fetchBundle: (
		context: EnterpriseControlPlaneFetchInput,
	) => Promise<EnterpriseConfigBundle | undefined>;
}): EnterpriseControlPlane {
	return {
		name: "workos",
		fetchBundle: input.fetchBundle,
	};
}
