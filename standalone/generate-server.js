const fs = require("fs")
const path = require("path")

const SERVER_TEMPLATE = "server-template.js"
const BUILD_DIR = "./build"
const OUT_FILE = `${BUILD_DIR}/server.js`

const grpcFiles = fs.readdirSync(BUILD_DIR).filter((f) => f.endsWith("_grpc_pb.js"))

const imports = grpcFiles
	.map((f) => {
		const name = path.basename(f, "_grpc_pb.js")
		return `const ${name}Proto = require("./${name}_grpc_pb");`
	})
	.join("\n")

const handlers = grpcFiles
	.map((f) => {
		const name = path.basename(f, "_grpc_pb.js")
		const serviceVar = `${name}Proto`
		const serviceName = `${capitalize(name)}ServiceService`
		const serviceFile = require(`${BUILD_DIR}/${name}_grpc_pb`)

		if (!serviceFile[serviceName]) return "" // skip files with no service
		const methods = Object.keys(serviceFile[serviceName])
		const methodEntries = methods.map((m) => `  ${m}: (call, callback) => ${m}(controller)`).join(",\n")

		return `server.addService(${serviceVar}.${serviceName}, {\n${methodEntries}\n});\n`
	})
	.join("")

function capitalize(s) {
	return s.charAt(0).toUpperCase() + s.slice(1)
}

const template = fs.readFileSync(SERVER_TEMPLATE, "utf8")
let output = "// GENERATED CODE -- DO NOT EDIT!\n"
// The template vars are like this because the presubmit demands that js files are
// formatted, so the vars are in comments to them being changed.
output += template.replace("// __IMPORTS__", imports).replace("// __HANDLERS__", handlers)
fs.writeFileSync(OUT_FILE, output)
