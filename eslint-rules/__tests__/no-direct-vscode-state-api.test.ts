const { RuleTester: StateApiRuleTester } = require("eslint")
const noDirectVscodeStateApiRule = require("../no-direct-vscode-state-api")

const stateApiRuleTester = new StateApiRuleTester({
	parser: require.resolve("@typescript-eslint/parser"),
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: "module",
		ecmaFeatures: {
			jsx: true,
		},
	},
})

stateApiRuleTester.run("no-direct-vscode-state-api", noDirectVscodeStateApiRule, {
	valid: [
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
		// Should allow state APIs in test files
		{
			code: `context.globalState.get("testKey")`,
			filename: "/foo/bar.test.ts",
		},
		// Should allow non-state API calls
		{
			code: `const value = someOtherObject.globalState.get("myKey");`,
			filename: "some-file.ts",
		},
		{
			code: `await myContext.secrets.store("key", "value");`,
			filename: "some-file.ts",
		},
	],
	invalid: [
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
