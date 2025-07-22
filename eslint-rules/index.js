// eslint-rules/index.js
const noDirectVscodeApi = require("./no-direct-vscode-api")

module.exports = {
	rules: {
		"no-direct-vscode-api": noDirectVscodeApi,
	},
	configs: {
		recommended: {
			plugins: ["local"],
			rules: {
				"local/no-direct-vscode-api": "warn",
			},
		},
	},
}
