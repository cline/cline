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
	"vscode.workspace.workspaceFolders": {
		messageId: "useHostBridge",
	},
	"vscode.workspace.asRelativePath": {
		messageId: "usePathUtils",
	},
	"vscode.workspace.getWorkspaceFolder": {
		messageId: "usePathUtils",
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
				"Use utilities in @/utils/fs instead of vscode.workspace.fs.stat.\n" +
				"Example: import { isDirectory } from '@/utils/fs' or use the file system methods from the host bridge provider.\n" +
				"Found: {{code}}",
			useHostBridge:
				"Use getHostBridgeProvider().workspaceClient.getWorkspacePaths({}) instead of vscode.workspace.workspaceFolders.\n" +
				"This provides a consistent abstraction across VSCode and standalone environments.\n" +
				"Found: {{code}}",
			usePathUtils:
				"Use path utilities from @/utils/path instead of direct VSCode workspace path methods.\n" +
				"This provides consistent path handling across different environments.\n" +
				"Found: {{code}}",
		},
		schema: [],
	},
	defaultOptions: [],

	create(context) {
		// Check if current file is in an exception directory or is grpc-client-base.ts
		const filename = context.filename
		const isGrpcClientBase = path.basename(filename) === "grpc-client-base.ts"

		// Skip checking files in src/hosts/vscode or standalone/runtime-files
		const isExceptionDirectory = filename.includes("/src/hosts/vscode/") || filename.includes("/standalone/runtime-files/")

		// Pattern for checking memberExpressions like vscode.workspace.fs.stat
		function checkMemberExpression(node) {
			// Skip if this file is in an exception directory or is grpc-client-base.ts
			if (isGrpcClientBase || isExceptionDirectory) {
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

		return {
			// Detect basic member expressions (e.g., vscode.postMessage)
			MemberExpression(node) {
				checkMemberExpression(node)
			},

			// Detect property access through destructuring
			VariableDeclarator(node) {
				// Skip if this file is in an exception directory or is grpc-client-base.ts
				if (isGrpcClientBase || isExceptionDirectory) {
					return
				}

				// Destructuring pattern checks removed as developers don't use the API this way
				// They always use direct imports: import * as vscode from "vscode" and direct access: vscode.thing.foo
			},
		}
	},
})
