const fs = require("fs")
const path = require("path")

const SERVER_TEMPLATE = "server-template.js"
const BUILD_DIR = "./build"
const OUT_FILE = `${BUILD_DIR}/index.js`
const EXTENSION_FILE = `${BUILD_DIR}/extension.js`

const grpcFiles = fs.readdirSync(BUILD_DIR).filter((f) => f.endsWith("_grpc_pb.js"))

const imports = grpcFiles
	.map((f) => {
		const name = path.basename(f, "_grpc_pb.js")
		return `const ${name}Proto = require("./${name}_grpc_pb");`
	})
	.join("\n")

function generateHandlers(grpcFiles) {
	let handlers = []
	let exports_ = []
	for (const f of grpcFiles) {
		const name = path.basename(f, "_grpc_pb.js")
		const serviceVar = `${name}Proto`
		const serviceName = `${capitalize(name)}ServiceService`
		const serviceFile = require(`${BUILD_DIR}/${name}_grpc_pb`)

		if (!serviceFile[serviceName]) continue

		const methods = Object.keys(serviceFile[serviceName])
		const methodLines = []
		for (const name of methods) {
			methodLines.push(`  ${name}: wrapHandler((call, callback) => extension.${name}(controller))`)
			exports_.push(`module.exports.${name} = ${name}`)
		}
		const methodEntries = methodLines.join(",\n")
		handlers.push(`server.addService(${serviceVar}.${serviceName}, {\n${methodEntries}\n});\n`)
	}
	return { handlers: handlers.join("\n"), exports_: exports_.join("\n") }
}

function capitalize(s) {
	return s.charAt(0).toUpperCase() + s.slice(1)
}

const { handlers, exports_ } = generateHandlers(grpcFiles)

let output = "// GENERATED CODE -- DO NOT EDIT!\n"
const template = fs.readFileSync(SERVER_TEMPLATE, "utf8")
// The template vars look like comments because the presubmit needs js files to be
// valid and formatted correctly.
output += template.replace("// __IMPORTS__", imports).replace("// __HANDLERS__", handlers)
fs.writeFileSync(OUT_FILE, output)

fs.writeFileSync(EXTENSION_FILE, exports_, { flag: "a" })
