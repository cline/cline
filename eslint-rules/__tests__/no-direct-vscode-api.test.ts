const { RuleTester: DirectApiRuleTester } = require("eslint")
const noDirectVscodeApiRule = require("../no-direct-vscode-api")

const directApiRuleTester = new DirectApiRuleTester({
	parser: require.resolve("@typescript-eslint/parser"),
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: "module",
		ecmaFeatures: {
			jsx: true,
		},
	},
})

directApiRuleTester.run("no-direct-vscode-api", noDirectVscodeApiRule, {
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
		// Should allow in exception directories
		{
			code: `vscode.workspace.workspaceFolders`,
			filename: "/src/hosts/vscode/host-bridge.ts",
		},
		{
			code: `vscode.workspace.fs.stat(uri)`,
			filename: "/standalone/runtime-files/helpers.ts",
		},
		// Should allow other vscode API calls
		{
			code: `vscode.commands.registerCommand("Hello")`,
			filename: "/foo/bar.ts",
		},
		// Should allow postMessage calls on other objects
		{
			code: `window.postMessage({ type: "test" }, "*")`,
			filename: "/foo/bar.ts",
		},
		// Should allow variables named vscode but not calling postMessage
		{
			code: `const vscode = { other: "method" }; vscode.other()`,
			filename: "/foo/bar.ts",
		},
		// Should allow vscode.postMessage in test files
		{
			code: `vscode.postMessage({ type: "newTask", text: message.text })`,
			filename: "/foo/bar.test.ts",
		},
	],
	invalid: [
		// Should disallow vscode.postMessage in regular files
		{
			code: `vscode.postMessage({ type: "test", data: {} })`,
			filename: "/foo/bar.ts",
			errors: [
				{
					messageId: "useGrpcClient",
				},
			],
		},
		// Should disallow vscode.postMessage in components
		{
			code: `vscode.postMessage({ type: "apiConfiguration", apiConfiguration })`,
			filename: "ApiOptions.tsx",
			errors: [
				{
					messageId: "useGrpcClient",
				},
			],
		},
		// Should disallow property access for disallowed APIs
		{
			code: `const folders = vscode.workspace.workspaceFolders;`,
			filename: "workspace.ts",
			errors: [
				{
					messageId: "useHostBridgeWorkspace",
				},
			],
		},
		// Should disallow method calls for disallowed APIs
		{
			code: `const relativePath = vscode.workspace.asRelativePath(filePath);`,
			filename: "path-utils.ts",
			errors: [
				{
					messageId: "usePathUtils",
				},
			],
		},
		// Should disallow nested property access
		{
			code: `const stats = await vscode.workspace.fs.stat(uri);`,
			filename: "file-utils.ts",
			errors: [
				{
					messageId: "useFsUtils",
				},
			],
		},
		// Should disallow getting a workspace folder
		{
			code: `const folder = vscode.workspace.getWorkspaceFolder(uri);`,
			filename: "path-helper.ts",
			errors: [
				{
					messageId: "usePathUtils",
				},
			],
		},
	],
})
