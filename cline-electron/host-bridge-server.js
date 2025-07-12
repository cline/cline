const grpc = require("@grpc/grpc-js")
const protoLoader = require("@grpc/proto-loader")
const path = require("path")
const {
	ElectronWorkspaceService,
	ElectronWindowService,
	ElectronTerminalService,
	ElectronCommandService,
	ElectronEnvService,
	ElectronWatchService,
} = require("./host-bridge-services")

/**
 * Host Bridge Server for Electron
 * Runs on port 50052 and provides real implementations
 */
class ElectronHostBridgeServer {
	constructor(mainWindow) {
		this.mainWindow = mainWindow
		this.server = new grpc.Server()
		this.services = {
			workspace: new ElectronWorkspaceService(),
			window: new ElectronWindowService(mainWindow),
			terminal: new ElectronTerminalService(),
			command: new ElectronCommandService(mainWindow),
			env: new ElectronEnvService(),
			watch: new ElectronWatchService(),
		}

		this.loadProtoAndSetupServices()
	}

	loadProtoAndSetupServices() {
		try {
			// Load proto definitions from descriptor set
			const descriptorPath = path.join(__dirname, "..", "proto", "descriptor_set.pb")
			const packageDefinition = protoLoader.loadFileDescriptorSetFromBuffer(require("fs").readFileSync(descriptorPath))

			this.proto = grpc.loadPackageDefinition(packageDefinition)
			console.log("✅ Proto definitions loaded successfully")

			this.setupServices()
		} catch (error) {
			console.error("❌ Error loading proto definitions:", error)
			throw error
		}
	}

	setupServices() {
		// Workspace Service
		this.server.addService(this.createServiceDefinition("WorkspaceService"), {
			getWorkspacePaths: this.wrapMethod(this.services.workspace.getWorkspacePaths.bind(this.services.workspace)),
			findFiles: this.wrapMethod(this.services.workspace.findFiles.bind(this.services.workspace)),
			searchFiles: this.wrapMethod(this.services.workspace.searchFiles.bind(this.services.workspace)),
		})

		// Window Service
		this.server.addService(this.createServiceDefinition("WindowService"), {
			showTextDocument: this.wrapMethod(this.services.window.showTextDocument.bind(this.services.window)),
			showOpenDialogue: this.wrapMethod(this.services.window.showOpenDialogue.bind(this.services.window)),
			getActiveTextEditor: this.wrapMethod(this.services.window.getActiveTextEditor.bind(this.services.window)),
			getVisibleTextEditors: this.wrapMethod(this.services.window.getVisibleTextEditors.bind(this.services.window)),
			showErrorMessage: this.wrapMethod(this.services.window.showErrorMessage.bind(this.services.window)),
			showInformationMessage: this.wrapMethod(this.services.window.showInformationMessage.bind(this.services.window)),
			showWarningMessage: this.wrapMethod(this.services.window.showWarningMessage.bind(this.services.window)),
		})

		// Terminal Service
		this.server.addService(this.createServiceDefinition("TerminalService"), {
			createTerminal: this.wrapMethod(this.services.terminal.createTerminal.bind(this.services.terminal)),
			getActiveTerminal: this.wrapMethod(this.services.terminal.getActiveTerminal.bind(this.services.terminal)),
			getAllTerminals: this.wrapMethod(this.services.terminal.getAllTerminals.bind(this.services.terminal)),
		})

		// Command Service
		this.server.addService(this.createServiceDefinition("CommandService"), {
			executeCommand: this.wrapMethod(this.services.command.executeCommand.bind(this.services.command)),
			setContext: this.wrapMethod(this.services.command.setContext.bind(this.services.command)),
			focusSidebar: this.wrapMethod(this.services.command.focusSidebar.bind(this.services.command)),
			newGroupRight: this.wrapMethod(this.services.command.newGroupRight.bind(this.services.command)),
			lockEditorGroup: this.wrapMethod(this.services.command.lockEditorGroup.bind(this.services.command)),
			openWalkthrough: this.wrapMethod(this.services.command.openWalkthrough.bind(this.services.command)),
			reloadWindow: this.wrapMethod(this.services.command.reloadWindow.bind(this.services.command)),
		})

		// Env Service
		this.server.addService(this.createServiceDefinition("EnvService"), {
			clipboardWriteText: this.wrapMethod(this.services.env.clipboardWriteText.bind(this.services.env)),
			clipboardReadText: this.wrapMethod(this.services.env.clipboardReadText.bind(this.services.env)),
		})

		// Watch Service
		this.server.addService(this.createServiceDefinition("WatchService"), {
			subscribeToFile: this.wrapStreamingMethod(this.services.watch.subscribeToFile.bind(this.services.watch)),
		})
	}

	createServiceDefinition(serviceName) {
		const service = this.proto.host[serviceName]
		if (!service) {
			throw new Error(`Service ${serviceName} not found in proto definitions`)
		}
		return service.service
	}

	wrapMethod(method) {
		return async (call, callback) => {
			try {
				console.log(`🔧 Host Bridge: ${method.name || "unknown method"}`)
				const result = await method(call.request)
				callback(null, result)
			} catch (error) {
				console.error("Host Bridge Error:", error)
				callback({
					code: grpc.status.INTERNAL,
					message: error.message,
				})
			}
		}
	}

	wrapStreamingMethod(method) {
		return async (call) => {
			try {
				const requestId = call.metadata.get("request-id").pop()?.toString()
				await method(call.request, call, requestId)
			} catch (error) {
				console.error("Host Bridge Streaming Error:", error)
				call.destroy({
					code: grpc.status.INTERNAL,
					message: error.message,
				})
			}
		}
	}

	async start() {
		return new Promise((resolve, reject) => {
			this.server.bindAsync("127.0.0.1:50052", grpc.ServerCredentials.createInsecure(), (err) => {
				if (err) {
					reject(err)
				} else {
					this.server.start()
					console.log("✅ Electron Host Bridge Server listening on 127.0.0.1:50052")
					resolve()
				}
			})
		})
	}

	stop() {
		this.server.forceShutdown()
		console.log("🛑 Electron Host Bridge Server stopped")
	}
}

module.exports = ElectronHostBridgeServer
