import type {
	BalanceResponse,
	OrganizationBalanceResponse,
	OrganizationUsageTransaction,
	PaymentTransaction,
	UsageTransaction,
	UserResponse,
} from "../../../../shared/ClineAccount"

const organizations = [
	{
		organizationId: "random-org-id",
		memberId: "random-member-id",
		name: "Test Organization",
		roles: ["member"],
		active: false,
	},
] satisfies UserResponse["organizations"]

export class ClineDataMock {
	public static readonly USERS = [
		{
			name: "test-personal-user",
			orgId: undefined,
			uid: "test-member-789",
			token: "test-personal-token",
			email: "personal@example.com",
			displayName: "Personal User",
			photoUrl: "https://example.com/personal-photo.jpg",
			organizations,
		},
		{
			name: "test-enterprise-user",
			orgId: "test-org-789",
			uid: "test-member-012",
			token: "test-enterprise-token",
			email: "test@example.com",
			displayName: "Enterprise User",
			photoUrl: "https://example.com/photo.jpg",
			organizations,
		},
	]

	// Helper method to get user by name from USERS array
	public static getUserByName(name: string) {
		return ClineDataMock.USERS.find((u) => u.name === name)
	}

	// Helper method to get user by token from USERS array
	public static findUserByToken(token: string) {
		return ClineDataMock.USERS.find((u) => u.token === token)
	}

	// Helper method to get all available tokens for testing
	public static getAllTokens() {
		return ClineDataMock.USERS.map((u) => ({ name: u.name, token: u.token }))
	}

	// Helper method to get default tokens by type
	public static getDefaultToken(type: "personal" | "enterprise") {
		const user = ClineDataMock.USERS.find((u) => (type === "personal" ? !u.orgId : !!u.orgId))
		return user?.token
	}

	constructor(userType?: "personal" | "enterprise") {
		if (userType === "personal") {
			const userData = ClineDataMock.findUserByToken("test-personal-token")
			this._currentUser = userData ? this._createUserResponse(userData) : null
		} else if (userType === "enterprise") {
			const userData = ClineDataMock.findUserByToken("test-enterprise-token")
			this._currentUser = userData ? this._createUserResponse(userData) : null
		} else {
			this._currentUser = null // Default to no user
		}
	}

	// Mock generation data for usage tracking
	private readonly mockGenerations = new Map<string, any>()

	public getGeneration(generationId: string): any {
		return this.mockGenerations.get(generationId)
	}

	private _currentUser: UserResponse | null = null

	public getCurrentUser(): UserResponse | null {
		return this._currentUser
	}

	public setCurrentUser(user: UserResponse | null) {
		this._currentUser = user
	}

	// Helper method to switch to a specific user type for testing
	public switchToUserType(type: "personal" | "enterprise"): UserResponse {
		const token = ClineDataMock.getDefaultToken(type)
		if (!token) {
			throw new Error(`No ${type} user found in USERS array`)
		}
		return this.getUserByToken(token)
	}
	// Helper to create UserResponse from USERS array data
	private _createUserResponse(userData: (typeof ClineDataMock.USERS)[0]): UserResponse {
		const currentTime = new Date().toISOString()

		return {
			id: userData.uid,
			email: userData.email,
			displayName: userData.displayName,
			photoUrl: userData.photoUrl,
			createdAt: currentTime,
			updatedAt: currentTime,
			organizations,
		}
	}

	public getUserByToken(token?: string): UserResponse {
		// Use default personal token if none provided
		const actualToken = token || ClineDataMock.getDefaultToken("personal") || "test-personal-token"
		const currentUser = this._getUserByToken(actualToken)
		this.setCurrentUser(currentUser)
		return currentUser
	}

	// Helper function to get user data based on auth token
	private _getUserByToken(token: string): UserResponse {
		const match = ClineDataMock.findUserByToken(token)

		if (!match) {
			// Default fallback user for backward compatibility
			return {
				id: "random-user-id",
				email: "test@example.com",
				displayName: "Test User",
				photoUrl: "https://example.com/photo.jpg",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				organizations,
			}
		}

		return this._createUserResponse(match)
	}

	public getMockBalance(userId: string): BalanceResponse {
		return {
			balance: 100000, // Sufficient credits for testing
			userId,
		}
	}

	public getMockOrgBalance(organizationId: string): OrganizationBalanceResponse {
		return {
			balance: 500.0,
			organizationId,
		}
	}

	public getMockUsageTransactions(
		userId: string,
		orgId?: string,
		max = 5,
	): UsageTransaction[] | OrganizationUsageTransaction[] {
		console.log("Generating mock usage transactions for", { orgId, userId })
		const usages: (OrganizationUsageTransaction | UsageTransaction)[] = []
		const currentTime = new Date().toISOString()
		const memberDisplayName = this._currentUser?.displayName || "Test User"
		const memberEmail = this._currentUser?.email || "test@example.com"
		const firstUsage = orgId ? 6000 : 1000

		for (let i = 0; i < max; i++) {
			const completionTokens = Math.floor(Math.random() * 100) + 50 // 50-150 tokens
			const randomCost = i === 0 ? firstUsage : Math.random() * 0.1 + 0.01 // $0.01-$0.11

			usages.push({
				id: `usage-${i + 1}`,
				aiInferenceProviderName: "anthropic",
				aiModelName: orgId ? "claude-4-opus-latest" : "claude-4-sonnet-latest",
				aiModelTypeName: "chat",
				completionTokens,
				costUsd: Number(randomCost.toFixed(2)),
				createdAt: currentTime,
				creditsUsed: Number(randomCost.toFixed(2)),
				generationId: `gen-${i + 1}`,
				memberDisplayName,
				memberEmail,
				organizationId: orgId || "",
				promptTokens: 100,
				totalTokens: 150,
				userId,
				metadata: {
					additionalProp1: "mock-data",
					additionalProp2: "e2e-test",
					additionalProp3: "mock-api",
				},
			})
		}
		return usages
	}

	public getMockPaymentTransactions(creatorId: string, max = 5): PaymentTransaction[] {
		const transactions: PaymentTransaction[] = []
		const currentTime = new Date().toISOString()

		for (let i = 0; i < max; i++) {
			const amountCents = Math.floor(Math.random() * 10000) + 1000 // $10.00-$110.00
			const credits = Math.random() * 100 + 10 // 10-110 credits

			transactions.push({
				paidAt: currentTime,
				creatorId,
				amountCents,
				credits,
			})
		}
		return transactions
	}
}
