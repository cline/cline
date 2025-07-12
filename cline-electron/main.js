// Simplified main.js using modular architecture
const AppManager = require("./src/app-manager")

// Create and initialize the app manager
const appManager = new AppManager()
appManager.initialize().catch((error) => {
	console.error("Failed to initialize app:", error)
	process.exit(1)
})
