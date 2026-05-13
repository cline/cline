import type {
	ClineAccountActionRequest,
	ProviderActionRequest,
} from "@cline/shared";
import type {
	ClineAccountBalance,
	ClineAccountOrganization,
	ClineAccountOrganizationBalance,
	ClineAccountOrganizationUsageTransaction,
	ClineAccountPaymentTransaction,
	ClineAccountUsageTransaction,
	ClineAccountUser,
	FeaturebaseTokenResponse,
} from "./types";

export interface ClineAccountOperations {
	fetchMe(): Promise<ClineAccountUser>;
	fetchBalance(userId?: string): Promise<ClineAccountBalance>;
	fetchUsageTransactions(
		userId?: string,
	): Promise<ClineAccountUsageTransaction[]>;
	fetchPaymentTransactions(
		userId?: string,
	): Promise<ClineAccountPaymentTransaction[]>;
	fetchUserOrganizations(): Promise<ClineAccountOrganization[]>;
	fetchOrganizationBalance(
		organizationId: string,
	): Promise<ClineAccountOrganizationBalance>;
	fetchOrganizationUsageTransactions(input: {
		organizationId: string;
		memberId?: string;
	}): Promise<ClineAccountOrganizationUsageTransaction[]>;
	switchAccount(organizationId?: string | null): Promise<void>;
	fetchFeaturebaseToken?(): Promise<FeaturebaseTokenResponse | undefined>;
}

export function isClineAccountActionRequest(
	request: ProviderActionRequest,
): request is ClineAccountActionRequest {
	return request.action === "clineAccount";
}

export async function executeClineAccountAction(
	request: ClineAccountActionRequest,
	service: ClineAccountOperations,
): Promise<unknown> {
	switch (request.operation) {
		case "fetchMe":
			return service.fetchMe();
		case "fetchBalance":
			return service.fetchBalance(request.userId);
		case "fetchUsageTransactions":
			return service.fetchUsageTransactions(request.userId);
		case "fetchPaymentTransactions":
			return service.fetchPaymentTransactions(request.userId);
		case "fetchUserOrganizations":
			return service.fetchUserOrganizations();
		case "fetchOrganizationBalance":
			return service.fetchOrganizationBalance(request.organizationId);
		case "fetchOrganizationUsageTransactions":
			return service.fetchOrganizationUsageTransactions({
				organizationId: request.organizationId,
				memberId: request.memberId,
			});
		case "switchAccount":
			await service.switchAccount(request.organizationId);
			return { updated: true };
		case "fetchFeaturebaseToken":
			return service.fetchFeaturebaseToken?.();
		default: {
			const exhaustive: never = request;
			throw new Error(
				`Unsupported Cline account operation: ${String(exhaustive)}`,
			);
		}
	}
}

export interface ProviderActionExecutor {
	runProviderAction(request: ProviderActionRequest): Promise<{
		result: unknown;
	}>;
}

export class RpcClineAccountService implements ClineAccountOperations {
	private readonly executor: ProviderActionExecutor;

	constructor(executor: ProviderActionExecutor) {
		this.executor = executor;
	}

	public async fetchMe(): Promise<ClineAccountUser> {
		return this.request<ClineAccountUser>({
			action: "clineAccount",
			operation: "fetchMe",
		});
	}

	public async fetchBalance(userId?: string): Promise<ClineAccountBalance> {
		return this.request<ClineAccountBalance>({
			action: "clineAccount",
			operation: "fetchBalance",
			...(userId?.trim() ? { userId: userId.trim() } : {}),
		});
	}

	public async fetchUsageTransactions(
		userId?: string,
	): Promise<ClineAccountUsageTransaction[]> {
		return this.request<ClineAccountUsageTransaction[]>({
			action: "clineAccount",
			operation: "fetchUsageTransactions",
			...(userId?.trim() ? { userId: userId.trim() } : {}),
		});
	}

	public async fetchPaymentTransactions(
		userId?: string,
	): Promise<ClineAccountPaymentTransaction[]> {
		return this.request<ClineAccountPaymentTransaction[]>({
			action: "clineAccount",
			operation: "fetchPaymentTransactions",
			...(userId?.trim() ? { userId: userId.trim() } : {}),
		});
	}

	public async fetchUserOrganizations(): Promise<ClineAccountOrganization[]> {
		return this.request<ClineAccountOrganization[]>({
			action: "clineAccount",
			operation: "fetchUserOrganizations",
		});
	}

	public async fetchOrganizationBalance(
		organizationId: string,
	): Promise<ClineAccountOrganizationBalance> {
		const orgId = organizationId.trim();
		if (!orgId) {
			throw new Error("organizationId is required");
		}
		return this.request<ClineAccountOrganizationBalance>({
			action: "clineAccount",
			operation: "fetchOrganizationBalance",
			organizationId: orgId,
		});
	}

	public async fetchOrganizationUsageTransactions(input: {
		organizationId: string;
		memberId?: string;
	}): Promise<ClineAccountOrganizationUsageTransaction[]> {
		const orgId = input.organizationId.trim();
		if (!orgId) {
			throw new Error("organizationId is required");
		}
		return this.request<ClineAccountOrganizationUsageTransaction[]>({
			action: "clineAccount",
			operation: "fetchOrganizationUsageTransactions",
			organizationId: orgId,
			...(input.memberId?.trim() ? { memberId: input.memberId.trim() } : {}),
		});
	}

	public async switchAccount(organizationId?: string | null): Promise<void> {
		await this.request<{ updated: boolean }>({
			action: "clineAccount",
			operation: "switchAccount",
			organizationId: organizationId?.trim() || null,
		});
	}

	public async fetchFeaturebaseToken(): Promise<
		FeaturebaseTokenResponse | undefined
	> {
		return this.request<FeaturebaseTokenResponse | undefined>({
			action: "clineAccount",
			operation: "fetchFeaturebaseToken",
		});
	}

	private async request<T>(request: ClineAccountActionRequest): Promise<T> {
		const response = await this.executor.runProviderAction(request);
		return response.result as T;
	}
}
