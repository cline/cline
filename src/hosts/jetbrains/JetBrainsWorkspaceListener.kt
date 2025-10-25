package bot.cline.host.listeners

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.ProjectManagerListener
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import bot.cline.core.ClineController

/**
 * Listens to IntelliJ project lifecycle events and updates workspace metadata
 * 
 * This listener bridges IntelliJ project events to Cline's platform-agnostic
 * workspace management system. When projects are opened or closed, it triggers
 * the TypeScript core functions to update workspace metadata.
 * 
 * Key Responsibilities:
 * - Detect when projects are opened
 * - Trigger workspace metadata initialization
 * - Associate tasks with newly opened workspaces
 * - Update lastOpened timestamps when projects close
 * 
 * Usage:
 * 1. Create an instance during plugin initialization
 * 2. Call initialize() to register the listener
 * 3. Listener will automatically handle all project lifecycle events
 * 
 * @param controller Bridge to TypeScript controller for calling core functions
 * @param scope Coroutine scope for asynchronous operations
 */
class JetBrainsWorkspaceListener(
    private val controller: ClineController,
    private val scope: CoroutineScope
) {
    
    /**
     * Initializes the project lifecycle listener
     * 
     * Subscribes to IntelliJ's ProjectManager events via the message bus.
     * All events are handled asynchronously to avoid blocking the UI thread.
     */
    fun initialize() {
        println("[JetBrainsWorkspaceListener] Initializing project lifecycle listener")
        
        // Subscribe to project lifecycle events via message bus
        ApplicationManager.getApplication().messageBus
            .connect()
            .subscribe(ProjectManager.TOPIC, object : ProjectManagerListener {
                
                /**
                 * Called when a project is opened in IntelliJ
                 * 
                 * Triggers:
                 * 1. Workspace metadata initialization (creates/updates metadata)
                 * 2. Task association (links orphaned tasks to this workspace)
                 * 
                 * @param project The project that was opened
                 */
                override fun projectOpened(project: Project) {
                    scope.launch {
                        try {
                            val projectName = project.name
                            val projectPath = project.basePath ?: "unknown"
                            
                            println("[JetBrainsWorkspaceListener] Project opened: $projectName at $projectPath")
                            
                            // Trigger workspace metadata initialization
                            // This calls the TypeScript function: initializeWorkspaceMetadata()
                            controller.initializeWorkspaceMetadata()
                            
                            // Associate any orphaned tasks with this workspace
                            // Tasks without workspace associations will be linked to this project
                            project.basePath?.let { path ->
                                controller.associateTasksWithWorkspace(path)
                            }
                            
                            println("[JetBrainsWorkspaceListener] Workspace metadata initialized for: $projectName")
                        } catch (e: Exception) {
                            System.err.println("[JetBrainsWorkspaceListener] Error handling project open: ${e.message}")
                            e.printStackTrace()
                        }
                    }
                }
                
                /**
                 * Called when a project is closed in IntelliJ
                 * 
                 * Updates the lastOpened timestamp for the workspace metadata.
                 * This preserves the workspace in history even after it's closed.
                 * 
                 * Note: We don't remove the workspace metadata - it's kept for:
                 * - Task history associations
                 * - Workspace filter dropdown
                 * - Quick reopening suggestions
                 * 
                 * @param project The project that was closed
                 */
                override fun projectClosed(project: Project) {
                    scope.launch {
                        try {
                            val projectName = project.name
                            val projectPath = project.basePath ?: "unknown"
                            
                            println("[JetBrainsWorkspaceListener] Project closed: $projectName at $projectPath")
                            
                            // Update lastOpened timestamp for closed workspace
                            // Workspace metadata is preserved for history
                            project.basePath?.let { path ->
                                controller.updateWorkspaceMetadata(path)
                            }
                            
                            println("[JetBrainsWorkspaceListener] Updated metadata for closed project: $projectName")
                        } catch (e: Exception) {
                            System.err.println("[JetBrainsWorkspaceListener] Error handling project close: ${e.message}")
                            e.printStackTrace()
                        }
                    }
                }
                
                /**
                 * Called just before a project is closed
                 * 
                 * This is called before projectClosed() and can be used for cleanup
                 * operations that need to happen while the project is still active.
                 * 
                 * Current Implementation: No-op (cleanup happens in projectClosed)
                 * 
                 * @param project The project that is about to be closed
                 */
                override fun projectClosing(project: Project) {
                    // Optional: Add any pre-close cleanup here if needed
                    // For example:
                    // - Save pending changes
                    // - Cancel ongoing operations
                    // - Release project-specific resources
                    
                    val projectName = project.name
                    println("[JetBrainsWorkspaceListener] Project closing: $projectName")
                }
            })
        
        println("[JetBrainsWorkspaceListener] Listener initialized successfully")
    }
}
