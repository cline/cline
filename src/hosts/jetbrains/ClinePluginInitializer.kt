package bot.cline.plugin

import com.intellij.openapi.project.Project
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import bot.cline.core.ClineController
import bot.cline.host.services.JetBrainsWorkspaceService
import bot.cline.host.listeners.JetBrainsWorkspaceListener

/**
 * Example initialization code for the Cline JetBrains plugin
 * 
 * This demonstrates how to integrate the workspace management components
 * during plugin initialization. The actual implementation will depend on
 * your plugin's architecture and initialization flow.
 * 
 * Key Integration Points:
 * 1. Register gRPC WorkspaceService with your existing gRPC server
 * 2. Initialize the workspace lifecycle listener
 * 3. Trigger one-time migrations and initial metadata setup
 * 
 * @see JetBrainsWorkspaceService for gRPC service implementation
 * @see JetBrainsWorkspaceListener for lifecycle event handling
 */
class ClinePluginInitializer(private val project: Project) {
    
    // Coroutine scope for async operations - tied to plugin lifecycle
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    // Workspace management components
    private lateinit var workspaceService: JetBrainsWorkspaceService
    private lateinit var workspaceListener: JetBrainsWorkspaceListener
    
    /**
     * Initialize workspace tracking for the Cline plugin
     * 
     * This should be called once during plugin initialization,
     * typically in your plugin's service or component initialization method.
     * 
     * Steps:
     * 1. Create and register the gRPC WorkspaceService
     * 2. Create and initialize the project lifecycle listener
     * 3. Run one-time migrations (safe to call multiple times)
     * 4. Initialize workspace metadata for currently open projects
     * 
     * @param grpcServer Your existing gRPC server instance
     * @param controller Bridge to the TypeScript controller
     */
    fun initialize(grpcServer: Any, controller: ClineController) {
        try {
            println("[ClinePlugin] Initializing workspace tracking...")
            
            // Step 1: Initialize and register gRPC WorkspaceService
            // This service handles getWorkspacePaths() RPC calls from TypeScript
            workspaceService = JetBrainsWorkspaceService()
            
            // TODO: Replace with your actual gRPC server registration method
            // grpcServer.addService(workspaceService)
            println("[ClinePlugin] Registered WorkspaceService with gRPC server")
            
            // Step 2: Initialize workspace lifecycle listener
            // This listens to project open/close events and updates metadata
            workspaceListener = JetBrainsWorkspaceListener(controller, scope)
            workspaceListener.initialize()
            println("[ClinePlugin] Initialized workspace lifecycle listener")
            
            // Step 3: Trigger migrations and initialization (async)
            scope.launch {
                try {
                    // One-time migration from old task history format
                    // Safe to call multiple times - it checks if migration is needed
                    println("[ClinePlugin] Running workspace metadata migration...")
                    controller.migrateWorkspaceMetadata()
                    
                    // Initialize metadata for currently open projects
                    // This will create/update workspace metadata for all open projects
                    println("[ClinePlugin] Initializing workspace metadata...")
                    controller.initializeWorkspaceMetadata()
                    
                    println("[ClinePlugin] Workspace tracking initialization complete!")
                } catch (e: Exception) {
                    System.err.println("[ClinePlugin] Error during workspace initialization: ${e.message}")
                    e.printStackTrace()
                }
            }
        } catch (e: Exception) {
            System.err.println("[ClinePlugin] Fatal error initializing workspace tracking: ${e.message}")
            e.printStackTrace()
        }
    }
    
    /**
     * Cleanup method - call when plugin is being disposed
     * 
     * This should be called in your plugin's dispose() or cleanup method
     * to properly release resources and cancel ongoing operations.
     */
    fun dispose() {
        try {
            println("[ClinePlugin] Disposing workspace tracking...")
            
            // Cancel all coroutines
            scope.cancel()
            
            println("[ClinePlugin] Workspace tracking disposed")
        } catch (e: Exception) {
            System.err.println("[ClinePlugin] Error during workspace tracking disposal: ${e.message}")
            e.printStackTrace()
        }
    }
}

/**
 * Example plugin service implementation
 * 
 * This shows how you might integrate the workspace initializer
 * into a typical IntelliJ plugin service.
 */
/*
class ClinePluginService(private val project: Project) {
    private lateinit var workspaceInitializer: ClinePluginInitializer
    
    init {
        // Initialize workspace tracking
        workspaceInitializer = ClinePluginInitializer(project)
        
        // Assuming you have a grpcServer and controller instance
        // workspaceInitializer.initialize(grpcServer, controller)
    }
    
    fun dispose() {
        workspaceInitializer.dispose()
    }
    
    companion object {
        fun getInstance(project: Project): ClinePluginService {
            return project.getService(ClinePluginService::class.java)
        }
    }
}
*/
