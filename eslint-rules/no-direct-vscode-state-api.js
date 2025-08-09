const { ESLintUtils } = require("@typescript-eslint/utils")
const path = require("path")

const createRule = ESLintUtils.RuleCreator((name) => `https://cline.bot/eslint-rules/${name}`)

// Configuration for context-based state APIs
const disallowedContextApis = {
	"globalState.get": {
		messageId: "useCacheServiceGlobalGet",
	},
	"globalState.update": {
		messageId: "useCacheServiceGlobalSet",
	},
	"workspaceState.get": {
		messageId: "useCacheServiceWorkspaceGet",
	},
	"workspaceState.update": {
		messageId: "useCacheServiceWorkspaceSet",
	},
	"secrets.get": {
		messageId: "useCacheServiceSecretsGet",
	},
	"secrets.store": {
		messageId: "useCacheServiceSecretsSet",
	},
	"secrets.delete": {
		messageId: "useCacheServiceSecretsSet",
	},
}

module.exports = createRule({
	name: "no-direct-vscode-state-api",
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow direct VSCode state API usage (context.globalState, context.workspaceState, context.secrets) in favor of CacheService",
			recommended: "error",
		},
		messages: {
			useCacheServiceGlobalGet:
				"Use CacheService.getGlobalStateKey() instead of context.globalState.get().\n" +
				"The CacheService provides fast in-memory access with automatic persistence.\n" +
				"Example: cacheService.getGlobalStateKey('myKey') instead of context.globalState.get('myKey').\n" +
				"Found: {{code}}",
			useCacheServiceGlobalSet:
				"Use CacheService.setGlobalState() instead of context.globalState.update().\n" +
				"The CacheService provides immediate updates with debounced persistence.\n" +
				"Example: cacheService.setGlobalState('myKey', value) instead of context.globalState.update('myKey', value).\n" +
				"Found: {{code}}",
			useCacheServiceWorkspaceGet:
				"Use CacheService.getWorkspaceStateKey() instead of context.workspaceState.get().\n" +
				"The CacheService provides fast in-memory access with automatic persistence.\n" +
				"Example: cacheService.getWorkspaceStateKey('myKey') instead of context.workspaceState.get('myKey').\n" +
				"Found: {{code}}",
			useCacheServiceWorkspaceSet:
				"Use CacheService.setWorkspaceState() instead of context.workspaceState.update().\n" +
				"The CacheService provides immediate updates with debounced persistence.\n" +
				"Example: cacheService.setWorkspaceState('myKey', value) instead of context.workspaceState.update('myKey', value).\n" +
				"Found: {{code}}",
			useCacheServiceSecretsGet:
				"Use CacheService.getSecretKey() instead of context.secrets.get().\n" +
				"The CacheService provides fast in-memory access with automatic persistence.\n" +
				"Example: cacheService.getSecretKey('mySecret') instead of context.secrets.get('mySecret').\n" +
				"Found: {{code}}",
			useCacheServiceSecretsSet:
				"Use CacheService.setSecret() instead of context.secrets.store() or context.secrets.delete().\n" +
				"The CacheService provides immediate updates with debounced persistence.\n" +
				"Example: cacheService.setSecret('mySecret', value) instead of context.secrets.store('mySecret', value).\n" +
				"For deletion, use: cacheService.setSecret('mySecret', undefined).\n" +
				"Found: {{code}}",
		},
		schema: [],
	},
	defaultOptions: [],

	create(context) {
		function isExcluded(filename) {
			// Skip checking test files
			if (filename.endsWith(".test.ts")) {
				return true
			}
			// Skip checking specific state-related files that need direct access
			const basename = path.basename(filename)
			if (
				basename === "CacheService.ts" ||
				basename === "state-helpers.ts" ||
				basename === "state-migrations.ts" ||
				basename === "extension.ts" ||
				basename === "common.ts" // CI might report errors from this virtual file
			) {
				return true
			}
			return false
		}

		// Check for context-based state API calls
		function checkContextStateApi(node) {
			if (isExcluded(context.filename)) {
				return
			}

			// Check if this is a member expression like context.globalState.get
			if (
				node.type === "MemberExpression" &&
				node.object &&
				node.object.type === "MemberExpression" &&
				node.object.object &&
				node.object.object.type === "Identifier" &&
				node.object.object.name === "context"
			) {
				const stateType = node.object.property.name // e.g., "globalState", "workspaceState", "secrets"
				const method = node.property.name // e.g., "get", "update", "store", "delete"
				const apiPath = `${stateType}.${method}`

				if (disallowedContextApis[apiPath]) {
					// For method calls, get the whole call expression
					let reportNode = node
					let parentNode = context.sourceCode.getAncestors(node).pop()
					if (parentNode && parentNode.type === "CallExpression" && parentNode.callee === node) {
						reportNode = parentNode
					}

					const callText = context.sourceCode.getText(reportNode).trim()

					context.report({
						node: reportNode,
						messageId: disallowedContextApis[apiPath].messageId,
						data: {
							code: callText,
						},
					})
				}
			}
		}

		return {
			// Detect member expressions (e.g., context.globalState.get)
			MemberExpression(node) {
				checkContextStateApi(node)
			},
		}
	},
})
