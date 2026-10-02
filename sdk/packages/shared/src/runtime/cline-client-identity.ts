export interface ClineClientIdentity {
	name?: string;
	version?: string;
	platform?: string;
	platformVersion?: string;
}

interface ClineClientIdentityGlobal {
	__clineClientIdentity?: ClineClientIdentity;
}

function identityHolder(): ClineClientIdentityGlobal {
	return globalThis as ClineClientIdentityGlobal;
}

export function setClineClientIdentity(
	identity: ClineClientIdentity | undefined,
): void {
	identityHolder().__clineClientIdentity = identity;
}

export function getClineClientIdentity(): ClineClientIdentity | undefined {
	return identityHolder().__clineClientIdentity;
}
