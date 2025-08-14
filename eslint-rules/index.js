// eslint-rules/index.js
const noDirectVscodeApi = require("./no-direct-vscode-api")
const noDirectVscodeStateApi = require("./no-direct-vscode-state-api")

module.exports = {
	rules: {
		"no-direct-vscode-api": noDirectVscodeApi,
		"no-direct-vscode-state-api": noDirectVscodeStateApi,
	},
	configs: {
		recommended: {
			plugins: ["local"],
			rules: {
				"local/no-direct-vscode-api": "warn",
				"local/no-direct-vscode-state-api": "error",
			},
		},
	},
}
