const fs = require("fs")
const path = require("path")

const DEST = "build/standalone.js"
const EXTENSION = "../dist/extension.js"

// Assemble output
const out = fs.createWriteStream(DEST)
out.write("// GENERATED CODE -- DO NOT EDIT!\n")

out.write(fs.readFileSync("vscode-impls.js"))

out.write('console.log("Loading extension.js...");\n')
out.write(fs.readFileSync(EXTENSION))

out.write(fs.readFileSync("build/server.js"))

out.end()

console.log(`Standalone cline service written to ${path.resolve(DEST)}`)
