const fs = require("fs")
const path = require("path")

const sourceDir = path.join(__dirname, "..", "node_modules", "tree-sitter-wasms", "out")
const targetDirs = [
	path.join(__dirname, "..", "src", "services", "tree-sitter", "wasm"),
	path.join(__dirname, "..", "out", "services", "tree-sitter", "wasm"),
]

// Create target directories if they don't exist
targetDirs.forEach((dir) => {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
})

// List of languages we support
const languages = ["javascript", "typescript", "python", "rust", "go", "java", "cpp", "c", "c_sharp", "ruby", "php", "swift"]

// Copy each WASM file to all target directories
languages.forEach((lang) => {
	const sourcePath = path.join(sourceDir, `tree-sitter-${lang}.wasm`)

	targetDirs.forEach((targetDir) => {
		const targetPath = path.join(targetDir, `tree-sitter-${lang}.wasm`)
		try {
			fs.copyFileSync(sourcePath, targetPath)
			console.log(`Copied ${lang} WASM file to ${targetDir}`)
		} catch (error) {
			console.error(`Warning: Could not copy WASM file for ${lang} to ${targetDir}: ${error.message}`)
		}
	})
})
