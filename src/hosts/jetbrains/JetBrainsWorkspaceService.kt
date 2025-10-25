package bot.cline.host.services

import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.roots.ModuleRootManager
import com.intellij.openapi.module.ModuleManager
import io.grpc.stub.StreamObserver
import bot.cline.host.proto.WorkspaceServiceGrpc
import bot.cline.host.proto.WorkspaceOuterClass.*

/**
 * JetBrains implementation of gRPC WorkspaceService
 * 
 * Provides workspace paths for single and multi-module IntelliJ projects.
 * This implementation supports:
 * - Single project queries via project ID
 * - All open projects when no ID specified
 * - Multi-module projects by including all content roots
 * 
 * Usage:
 * 1. Register this service with the gRPC server during plugin initialization
 * 2. The TypeScript core will call getWorkspacePaths() via HostProvider.workspace
 * 3. Workspace metadata will be created/updated in global state
 * 
 * @see proto/host/workspace.proto for the gRPC contract
 */
class JetBrainsWorkspaceService : WorkspaceServiceGrpc.WorkspaceServiceImplBase() {
    
    /**
     * Implements getWorkspacePaths RPC
     * 
     * Returns a list of workspace paths for the requested project(s).
     * For multi-module projects, includes the base path and all module content roots.
     * 
     * @param request Contains optional project ID. If omitted, returns all open projects.
     * @param responseObserver Stream observer for sending the response
     */
    override fun getWorkspacePaths(
        request: GetWorkspacePathsRequest,
        responseObserver: StreamObserver<GetWorkspacePathsResponse>
    ) {
        try {
            val paths = mutableListOf<String>()
            
            if (request.hasId()) {
                // Get specific project by ID (locationHash)
                val project = ProjectManager.getInstance().openProjects.find { 
                    it.locationHash == request.id 
                }
                if (project != null) {
                    paths.addAll(getProjectPaths(project))
                } else {
                    // Project not found - log warning but return empty list
                    System.err.println("[JetBrainsWorkspaceService] Project not found with ID: ${request.id}")
                }
            } else {
                // Get all open projects
                ProjectManager.getInstance().openProjects.forEach { project ->
                    paths.addAll(getProjectPaths(project))
                }
            }
            
            // Build and send response
            val response = GetWorkspacePathsResponse.newBuilder()
                .apply { 
                    if (request.hasId()) {
                        id = request.id
                    }
                }
                .addAllPaths(paths.distinct())  // Remove duplicates
                .build()
            
            responseObserver.onNext(response)
            responseObserver.onCompleted()
            
            // Log for debugging
            println("[JetBrainsWorkspaceService] Returned ${paths.size} workspace path(s)")
        } catch (e: Exception) {
            System.err.println("[JetBrainsWorkspaceService] Error getting workspace paths: ${e.message}")
            e.printStackTrace()
            responseObserver.onError(e)
        }
    }
    
    /**
     * Extracts all workspace paths from a project
     * 
     * For single-module projects, returns just the base path.
     * For multi-module projects, returns base path + all module content roots.
     * 
     * @param project The IntelliJ project
     * @return List of absolute file system paths
     */
    private fun getProjectPaths(project: Project): List<String> {
        val paths = mutableListOf<String>()
        
        // Add project base path (main directory)
        project.basePath?.let { 
            paths.add(it)
            println("[JetBrainsWorkspaceService] Added base path: $it")
        }
        
        // Add content roots from all modules (for multi-module projects)
        try {
            ModuleManager.getInstance(project).modules.forEach { module ->
                ModuleRootManager.getInstance(module).contentRoots.forEach { root ->
                    val rootPath = root.path
                    if (rootPath !in paths) {  // Avoid duplicates
                        paths.add(rootPath)
                        println("[JetBrainsWorkspaceService] Added module content root: $rootPath")
                    }
                }
            }
        } catch (e: Exception) {
            System.err.println("[JetBrainsWorkspaceService] Error getting module paths: ${e.message}")
            // Continue with just the base path if module enumeration fails
        }
        
        return paths.distinct()
    }
}
