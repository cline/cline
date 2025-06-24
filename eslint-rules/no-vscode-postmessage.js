const { ESLintUtils } = require("@typescript-eslint/utils")
const path = require("path")

const createRule = ESLintUtils.RuleCreator((name) => `https://cline.bot/eslint-rules/${name}`)

module.exports = createRule({
	name: "no-vscode-postmessage",
	meta: {
		type: "problem",
		docs: {
			description: "Ban vscode.postMessage() calls in favor of gRPC service clients, except in grpc-client-base.ts",
			recommended: "error",
		},
		messages: {
			useGrpcClient:
				"Use gRPC service clients instead of vscode.postMessage().\n" +
				"Example: AccountServiceClient.methodName(RequestType.create({...})) instead of vscode.postMessage({type: '...'}).\n" +
				"Found: {{code}}",
		},
		schema: [],
	},
	defaultOptions: [],

	create(context) {
		// Check if current file is grpc-client-base.ts (exception case)
		const filename = context.filename
		const isGrpcClientBase = path.basename(filename) === "grpc-client-base.ts"

		return {
			// Detect vscode.postMessage calls
			"CallExpression[callee.type='MemberExpression']"(node) {
				// Skip if this is grpc-client-base.ts
				if (isGrpcClientBase) {
					return
				}

				const callee = node.callee

				// Check for vscode.postMessage pattern
				if (
					callee.object &&
					callee.object.type === "Identifier" &&
					callee.object.name === "vscode" &&
					callee.property &&
					callee.property.name === "postMessage"
				) {
					const sourceCode = context.sourceCode
					const callText = sourceCode.getText(node).trim()

					context.report({
						node,
						messageId: "useGrpcClient",
						data: {
							code: callText,
						},
					})
				}
			},
		}
	},
})
