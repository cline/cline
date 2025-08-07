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
		// Should allow state APIs in CacheService.ts
		{
			code: `await context.globalState.update("myKey", value);`,
			filename: "CacheService.ts",
		},
		{
			code: `const value = context.globalState.get("myKey");`,
			filename: "/src/core/storage/CacheService.ts",
		},
		{
			code: `await context.secrets.store("apiKey", value);`,
			filename: "CacheService.ts",
		},
		// Should allow state APIs in state-helpers.ts
		{
			code: `const value = context.globalState.get("myKey");`,
			filename: "state-helpers.ts",
		},
		{
			code: `await context.secrets.get("apiKey");`,
			filename: "/src/core/storage/utils/state-helpers.ts",
		},
		// Should allow state APIs in state-migrations.ts
		{
			code: `await context.globalState.update("myKey", value);`,
			filename: "state-migrations.ts",
		},
		{
			code: `const value = context.workspaceState.get("myKey");`,
			filename: "/src/core/storage/state-migrations.ts",
		},
		// Should allow state APIs in extension.ts
		{
			code: `const distinctId = context.globalState.get<string>("cline.distinctId");`,
			filename: "extension.ts",
		},
		{
			code: `await context.globalState.update("clineVersion", currentVersion);`,
			filename: "/src/extension.ts",
		},
		{
			code: `const secret = await context.secrets.get("clineAccountId");`,
			filename: "extension.ts",
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
		// Should disallow context.globalState.get
		{
			code: `const value = context.globalState.get("myKey");`,
			filename: "some-file.ts",
			errors: [
				{
					messageId: "useCacheServiceGlobalGet",
				},
			],
		},
		// Should disallow context.globalState.update
		{
			code: `await context.globalState.update("myKey", "myValue");`,
			filename: "some-file.ts",
			errors: [
				{
					messageId: "useCacheServiceGlobalSet",
				},
			],
		},
		// Should disallow context.workspaceState.get
		{
			code: `const value = context.workspaceState.get("myKey");`,
			filename: "some-file.ts",
			errors: [
				{
					messageId: "useCacheServiceWorkspaceGet",
				},
			],
		},
		// Should disallow context.workspaceState.update
		{
			code: `await context.workspaceState.update("myKey", "myValue");`,
			filename: "some-file.ts",
			errors: [
				{
					messageId: "useCacheServiceWorkspaceSet",
				},
			],
		},
		// Should disallow context.secrets.get
		{
			code: `const secret = await context.secrets.get("apiKey");`,
			filename: "some-file.ts",
			errors: [
				{
					messageId: "useCacheServiceSecretsGet",
				},
			],
		},
		// Should disallow context.secrets.store
		{
			code: `await context.secrets.store("apiKey", "secret-value");`,
			filename: "some-file.ts",
			errors: [
				{
					messageId: "useCacheServiceSecretsSet",
				},
			],
		},
		// Should disallow context.secrets.delete
		{
			code: `await context.secrets.delete("apiKey");`,
			filename: "some-file.ts",
			errors: [
				{
					messageId: "useCacheServiceSecretsSet",
				},
			],
		},
		// Should disallow chained state API calls
		{
			code: `const value = await context.globalState.get("key") || "default";`,
			filename: "some-file.ts",
			errors: [
				{
					messageId: "useCacheServiceGlobalGet",
				},
			],
		},
		// Should disallow state API calls in Promise.all
		{
			code: `await Promise.all([context.secrets.get("key1"), context.secrets.get("key2")]);`,
			filename: "some-file.ts",
			errors: [
				{
					messageId: "useCacheServiceSecretsGet",
				},
				{
					messageId: "useCacheServiceSecretsGet",
				},
			],
		},
	],
})
