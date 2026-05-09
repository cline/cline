import type { IdentityAdapter, IdentityResolveInput } from "../../contracts";
import type { WorkosResolvedIdentity } from "./types";

export function createWorkosIdentityAdapter(input: {
	resolveIdentity: (
		context: IdentityResolveInput,
	) => Promise<WorkosResolvedIdentity | undefined>;
}): IdentityAdapter {
	return {
		name: "workos",
		async resolveIdentity(context) {
			const resolved = await input.resolveIdentity(context);
			if (!resolved) {
				return undefined;
			}
			return {
				claims: resolved.claims,
				token: resolved.token,
				context: resolved.context,
				metadata: resolved.metadata,
			};
		},
	};
}
