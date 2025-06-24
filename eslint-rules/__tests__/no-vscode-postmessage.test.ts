const { RuleTester: VscodeRuleTester } = require("eslint")
const vscodePostmessageRule = require("../no-vscode-postmessage")

const vscodeRuleTester = new VscodeRuleTester({
	parser: require.resolve("@typescript-eslint/parser"),
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: "module",
		ecmaFeatures: {
			jsx: true,
		},
	},
})

vscodeRuleTester.run("no-vscode-postmessage", vscodePostmessageRule, {
	valid: [
		// Should allow vscode.postMessage in grpc-client-base.ts
		{
			code: `vscode.postMessage({ type: "grpc_request", data: {} })`,
			filename: "grpc-client-base.ts",
		},
		{
			code: `vscode.postMessage({ type: "grpc_request_cancel" })`,
			filename: "/path/to/grpc-client-base.ts",
		},
		// Should allow other vscode API calls
		{
			code: `vscode.window.showInformationMessage("Hello")`,
			filename: "test.ts",
		},
		// Should allow postMessage calls on other objects
		{
			code: `window.postMessage({ type: "test" }, "*")`,
			filename: "test.ts",
		},
		// Should allow variables named vscode but not calling postMessage
		{
			code: `const vscode = { other: "method" }; vscode.other()`,
			filename: "test.ts",
		},
	],
	invalid: [
		// Should ban vscode.postMessage in regular files
		{
			code: `vscode.postMessage({ type: "test", data: {} })`,
			filename: "test.ts",
			errors: [
				{
					messageId: "useGrpcClient",
				},
			],
		},
		// Should ban vscode.postMessage in components
		{
			code: `vscode.postMessage({ type: "apiConfiguration", apiConfiguration })`,
			filename: "ApiOptions.tsx",
			errors: [
				{
					messageId: "useGrpcClient",
				},
			],
		},
		// Should ban vscode.postMessage in test files
		{
			code: `vscode.postMessage({ type: "newTask", text: message.text })`,
			filename: "test.test.ts",
			errors: [
				{
					messageId: "useGrpcClient",
				},
			],
		},
	],
})
