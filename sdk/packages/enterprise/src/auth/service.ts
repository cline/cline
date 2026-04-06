import type {
	EnterpriseAuthServiceOptions,
	EnterpriseIdentitySession,
	EnterpriseSyncContext,
} from "../contracts";

export class EnterpriseAuthService {
	constructor(private readonly options: EnterpriseAuthServiceOptions) {}

	async resolveIdentity(
		context: EnterpriseSyncContext,
	): Promise<EnterpriseIdentitySession | undefined> {
		const identity = await this.options.identity.resolveIdentity(context);
		if (identity?.token && this.options.tokenStore) {
			await this.options.tokenStore.write(identity.token);
		}
		return identity;
	}
}
