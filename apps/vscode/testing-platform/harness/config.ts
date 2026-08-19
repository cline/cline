// Note: This list is temporary. Some items may remain in the long run,
// but our goal is to reduce it over time by continuously improving
// how we prepare the testing-platform environment.
export const NON_DETERMINISTIC_FIELDS = [
	"stateJson.version",
	"stateJson.distinctId",
	"stateJson.shouldShowAnnouncement",
	"stateJson.platform",
	"stateJson.clineMessages.ts",
	"paymentTransactions.paidAt",
	"usageTransactions.createdAt",

	"stateJson.taskHistory.cwdOnTaskInitialization",
	"stateJson.taskHistory.id",
	"stateJson.taskHistory.size",
	"stateJson.taskHistory.ts",
	"stateJson.taskHistory.ulid",
	"stateJson.taskHistory.cacheWrites",
	"stateJson.taskHistory.cacheReads",
	"stateJson.taskHistory.tokensIn",
	"stateJson.taskHistory.tokensOut",
	"stateJson.taskHistory.totalCost",

	"stateJson.currentTaskItem",

	"stateJson.workspaceRoots.commitHash",
	"stateJson.workspaceRoots.name",
	"stateJson.workspaceRoots.path",
	"stateJson.workspaceRoots.vcs",

	"tasks.id",
	"tasks.size",
	"tasks.ts",
	"tasks.ulid",
	"tasks.cacheWrites",
	"tasks.cacheReads",
	"tasks.tokensIn",
	"tasks.tokensOut",
	"tasks.totalCost",

	"stateJson.clineMessages",
	"stateJson.autoApprovalSettings.version",
	"stateJson.browserSettings.chromeExecutablePath",
]
