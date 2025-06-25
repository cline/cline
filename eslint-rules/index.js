// eslint-rules/index.js
const noProtobufObjectLiterals = require("./no-protobuf-object-literals")
const noGrpcClientObjectLiterals = require("./no-grpc-client-object-literals")
const noVscodePostmessage = require("./no-vscode-postmessage")

module.exports = {
	rules: {
		"no-protobuf-object-literals": noProtobufObjectLiterals,
		"no-grpc-client-object-literals": noGrpcClientObjectLiterals,
		"no-vscode-postmessage": noVscodePostmessage,
	},
	configs: {
		recommended: {
			plugins: ["local"],
			rules: {
				"local/no-protobuf-object-literals": "error",
				"local/no-grpc-client-object-literals": "error",
				"local/no-vscode-postmessage": "error",
			},
		},
	},
}
