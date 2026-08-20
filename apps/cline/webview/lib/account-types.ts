export interface ClineAccountUser {
	id?: string;
	userId?: string;
	email?: string;
	displayName?: string;
	name?: string;
	photoUrl?: string;
	organizations?: ClineAccountOrganization[];
}
export interface ClineAccountOrganization { id: string; name: string; role?: string; membersCount?: number }
export interface ClineAccountBalance { balance: number; credits?: number }
export interface ClineAccountOrganizationBalance extends ClineAccountBalance { organizationId?: string }
export interface ClineAccountUsageTransaction { id?: string; date?: string; createdAt?: string; model?: string; description?: string; amount?: number; cost?: number; tokens?: number }
export interface ClineAccountOrganizationUsageTransaction extends ClineAccountUsageTransaction { organizationId?: string }
export interface ClineAccountPaymentTransaction { id?: string; date?: string; createdAt?: string; description?: string; amount?: number; status?: string }
