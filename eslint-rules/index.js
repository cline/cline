// eslint-rules/index.js
const noGrpcClientObjectLiterals = require("./no-grpc-client-object-literals")

module.exports = {
	rules: {
		"no-grpc-client-object-literals": noGrpcClientObjectLiterals,
	},
	configs: {
		recommended: {
			plugins: ["local"],
			rules: {
				"local/no-grpc-client-object-literals": "error",
			},
		},
	},
}
