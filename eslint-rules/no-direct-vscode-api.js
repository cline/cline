const { ESLintUtils } = require("@typescript-eslint/utils")
const path = require("path")

const createRule = ESLintUtils.RuleCreator((name) => `https://cline.bot/eslint-rules/${name}`)

// Configuration of disallowed VSCode APIs and their recommended alternatives
const disallowedApis = {
	"vscode.postMessage": {
		messageId: "useGrpcClient",
	},
	"vscode.workspace.fs.stat": {
		messageId: "useFsUtils",
	},
	"vscode.workspace.fs.writeFile": {
		messageId: "useFsUtils",
	},
	"vscode.workspace.workspaceFolders": {
		messageId: "useHostBridgeWorkspace",
	},
	"vscode.workspace.asRelativePath": {
		messageId: "usePathUtils",
	},
	"vscode.workspace.getWorkspaceFolder": {
		messageId: "usePathUtils",
	},
	"vscode.window.showTextDocument": {
		messageId: "useHostBridge",
	},
	"vscode.workspace.applyEdit": {
		messageId: "useHostBridge",
	},
	"vscode.window.onDidChangeActiveTextEditor": {
		messageId: "useHostBridge",
	},
	"vscode.env.openExternal": {
		messageId: "useUtils",
	},
	"vscode.window.showWarningMessage": {
		messageId: "useHostBridgeShowMessage",
	},
	"vscode.window.showOpenDialog": {
		messageId: "useHostBridgeShowMessage",
	},
	"vscode.window.showErrorMessage": {
		messageId: "useHostBridgeShowMessage",
	},
	"vscode.window.showInformationMessage": {
		messageId: "useHostBridgeShowMessage",
	},
	"vscode.window.showInputBox": {
		messageId: "useHostBridge",
	},
	"vscode.workspace.findFiles": {
		messageId: "useNative",
	},
}

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
	name: "no-direct-vscode-api",
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow direct VSCode API usage in favor of Cline's abstraction layers, except in src/hosts/vscode and standalone/runtime-files directories",
			recommended: "error",
		},
		messages: {
			useGrpcClient:
				"Use gRPC service clients instead of vscode.postMessage().\n" +
				"Example: AccountServiceClient.methodName(RequestType.create({...})) instead of vscode.postMessage({type: '...'}).\n" +
				"Found: {{code}}",
			useFsUtils:
				"Use utilities in @/utils/fs instead of vscode.workspace.fs\n" +
				"Example: import { isDirectory } from '@/utils/fs' or use the file system methods from the host bridge provider.\n" +
				"Found: {{code}}",
			usePathUtils:
				"Use path utilities from @/utils/path instead of VSCode workspace path methods.\n" +
				"This provides consistent path handling across different environments.\n" +
				"Found: {{code}}",
			useHostBridgeWorkspace:
				"Use HostProvider.workspace.getWorkspacePaths({}) instead of vscode.workspace.workspaceFolders.\n" +
				"This provides a consistent abstraction across VSCode and standalone environments.\n" +
				"Found: {{code}}",
			useHostBridgeShowMessage:
				"Use HostProvider.window.showMessage instead of the vscode.window.showMessage.\n" +
				"This provides a consistent abstraction across VSCode and standalone environments.\n" +
				"Found: {{code}}",
			useHostBridge:
				"Use the host bridge instead of calling vscode APIs directly.\n" +
				"This provides a consistent abstraction across VSCode and standalone environments.\n" +
				"Found: {{code}}",
			useUtils:
				"Use utilities in @/utils instead of calling vscode APIs directly.\n" +
				"This provides a consistent abstraction across VSCode and standalone environments.\n" +
				"Found: {{code}}",
			useNative:
				"Use a native Javascript API instead of calling the vscode API.\n" +
				"This provides a consistent abstraction across VSCode and standalone environments.\n" +
				"Found: {{code}}",
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
		// Pattern for checking memberExpressions like vscode.workspace.fs.stat
		function checkMemberExpression(node) {
			if (isExcluded(context.filename)) {
				// Skip if this file is being excluded.
				return
			}

			// For handling nested properties like vscode.workspace.fs.stat
			function getFullPropertyPath(node) {
				if (node.type !== "MemberExpression") {
					return node.name || ""
				}

				const objectPart = getFullPropertyPath(node.object)
				const propertyPart = node.property.name || ""

				return objectPart ? `${objectPart}.${propertyPart}` : propertyPart
			}

			// Check if the expression matches one of our disallowed patterns
			if (node.object && node.object.type === "Identifier" && node.object.name === "vscode") {
				const fullPath = `vscode.${node.property.name}`
				checkDisallowedApi(fullPath, node)
			}
			// Handle nested expressions like vscode.workspace.fs.stat
			else if (node.object && node.object.type === "MemberExpression") {
				const fullPath = getFullPropertyPath(node)

				// Only proceed if it starts with vscode
				if (fullPath.startsWith("vscode.")) {
					checkDisallowedApi(fullPath, node)
				}
			}
		}

		// Check if an expression matches a disallowed API and report if it does
		function checkDisallowedApi(expressionPath, node) {
			// Check exact matches
			if (disallowedApis[expressionPath]) {
				reportViolation(expressionPath, node)
				return
			}

			// Check prefix matches (for nested properties)
			for (const disallowedApi in disallowedApis) {
				// For direct property access like vscode.workspace.workspaceFolders
				if (expressionPath === disallowedApi) {
					reportViolation(disallowedApi, node)
					return
				}

				// For method calls like vscode.workspace.asRelativePath(...)
				if (expressionPath.startsWith(`${disallowedApi}.`) || expressionPath.startsWith(`${disallowedApi}(`)) {
					reportViolation(disallowedApi, node)
					return
				}
			}
		}

		// Report a violation with the appropriate message
		function reportViolation(disallowedApi, node) {
			const sourceCode = context.sourceCode
			const config = disallowedApis[disallowedApi]

			// For method calls, get the whole call expression
			let reportNode = node
			let parentNode = sourceCode.getAncestors(node).pop()
			if (parentNode && parentNode.type === "CallExpression" && parentNode.callee === node) {
				reportNode = parentNode
			}

			const callText = sourceCode.getText(reportNode).trim()

			context.report({
				node: reportNode,
				messageId: config.messageId,
				data: {
					code: callText,
				},
			})
		}

		function isExcluded(filename) {
			// Check if current file is in an exception directory or is grpc-client-base.ts
			if (path.basename(filename) === "grpc-client-base.ts") {
				return true
			}
			// Skip checking files in src/hosts/vscode or standalone/runtime-files
			if (filename.includes("/src/hosts/vscode/")) {
				return true
			}
			if (filename.includes("/standalone/runtime-files/")) {
				return true
			}
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
				basename === "extension.ts"
			) {
				return true
			}
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
			// Detect basic member expressions (e.g., vscode.postMessage)
			MemberExpression(node) {
				checkMemberExpression(node)
				checkContextStateApi(node)
			},

			// Detect property access through destructuring
			VariableDeclarator(node) {
				// Skip if this file is in an exception directory or is grpc-client-base.ts
				if (isExcluded(context.filename)) {
					return
				}

				// Destructuring pattern checks removed as developers don't use the API this way
				// They always use direct imports: import * as vscode from "vscode" and direct access: vscode.thing.foo
			},
		}
	},
})
