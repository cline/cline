const fs = require("fs")
const path = require("path")
const grpc = require("@grpc/grpc-js")
const protoLoader = require("@grpc/proto-loader")

const SERVER_TEMPLATE = "server-template.js"
const BUILD_DIR = "./build"
const OUT_FILE = `${BUILD_DIR}/index.js`
const EXTENSION_FILE = `${BUILD_DIR}/extension.js`

const protoFiles = fs
	.readdirSync(BUILD_DIR)
	.filter((f) => f.endsWith(".proto"))
	.map((f) => path.join(BUILD_DIR, f))

const packageDefinition = protoLoader.loadSync(protoFiles)
const proto = grpc.loadPackageDefinition(packageDefinition)

function generateHandlersAndExports() {
	let handlers = []
	let exports_ = []
	for (const [name, def] of Object.entries(proto.cline)) {
		if (!("service" in def)) {
			continue
		}
		const methodLines = []
		for (const [method, _] of Object.entries(def.service)) {
			methodLines.push(`  ${method}: wrapHandler(extension.${method})`)
			exports_.push(`module.exports.${method} = ${method}`)
		}
		const methodEntries = methodLines.join(",\n")
		handlers.push(`server.addService(proto.cline.${name}.service, {\n${methodEntries}\n});\n`)
	}
	return { handlers: handlers.join("\n"), exports_: exports_.join("\n") }
}

const { handlers, exports_ } = generateHandlersAndExports()

const protoFilesTemplate = fs
	.readdirSync(BUILD_DIR)
	.filter((f) => f.endsWith(".proto"))
	.map((f) => "'" + f + "'")
	.join(",\n  ")

let output = "// GENERATED CODE -- DO NOT EDIT!\n"
const template = fs.readFileSync(SERVER_TEMPLATE, "utf8")
// The template vars look like comments because the presubmit needs js files to be
// valid and formatted correctly.
output += template.replace("// __PROTO_FILES__", protoFilesTemplate).replace("// __HANDLERS__", handlers)
fs.writeFileSync(OUT_FILE, output)

fs.writeFileSync(EXTENSION_FILE, exports_, { flag: "a" })
