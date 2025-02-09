const fs = require("fs")
const path = require("path")

const sourceDir = path.join(__dirname, "..", "node_modules", "tree-sitter-wasms", "out")
const targetDir = path.join(__dirname, "..", "src", "services", "tree-sitter", "wasm")

// Create target directory if it doesn't exist
if (!fs.existsSync(targetDir)) {
	fs.mkdirSync(targetDir, { recursive: true })
}

// List of languages we support
const languages = ["javascript", "typescript", "python", "rust", "go", "java", "cpp", "c", "c_sharp", "ruby", "php", "swift"]

// Copy each WASM file
languages.forEach((lang) => {
	const sourcePath = path.join(sourceDir, `tree-sitter-${lang}.wasm`)
	const targetPath = path.join(targetDir, `tree-sitter-${lang}.wasm`)

	try {
		fs.copyFileSync(sourcePath, targetPath)
		console.log(`Copied ${lang} WASM file`)
	} catch (error) {
		console.error(`Warning: Could not copy WASM file for ${lang}: ${error.message}`)
	}
})
