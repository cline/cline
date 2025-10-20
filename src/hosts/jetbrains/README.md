# JetBrains Workspace Support Implementation

This directory contains the Kotlin implementation files for JetBrains IDE support of Cline's multi-workspace features.

## Overview

These files implement the platform-specific bridge between IntelliJ Platform IDEs and Cline's platform-agnostic workspace management core. The implementation follows the same pattern as the VSCode host adapter in `src/hosts/vscode/`.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│           IntelliJ IDEA / JetBrains IDE            │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  JetBrainsWorkspaceListener.kt              │  │
│  │  - Listens to project open/close events     │  │
│  │  - Triggers workspace metadata updates       │  │
│  └────────────────┬─────────────────────────────┘  │
│                   │                                 │
│  ┌────────────────▼─────────────────────────────┐  │
│  │  JetBrainsWorkspaceService.kt               │  │
│  │  - Implements gRPC WorkspaceService         │  │
│  │  - Returns workspace paths via RPC           │  │
│  │  - Supports multi-module projects            │  │
│  └────────────────┬─────────────────────────────┘  │
│                   │                                 │
│  ┌────────────────▼─────────────────────────────┐  │
│  │  ClinePluginInitializer.kt                  │  │
│  │  - Wires everything together                 │  │
│  │  - Plugin initialization logic               │  │
│  └──────────────────────────────────────────────┘  │
└───────────────────┼─────────────────────────────────┘
                    │ gRPC
                    ▼
┌─────────────────────────────────────────────────────┐
│      Cline Core (TypeScript - Platform Agnostic)   │
│                                                     │
│  - initializeWorkspaceMetadata()                   │
│  - updateWorkspaceMetadataFromEvent()              │
│  - Workspace filtering, tags, warnings             │
└─────────────────────────────────────────────────────┘
```

## Files

### 1. JetBrainsWorkspaceService.kt

**Purpose**: gRPC service implementation for the `WorkspaceService` protocol.

**Key Methods**:
- `getWorkspacePaths()`: Returns list of workspace paths for current project(s)
- `getProjectPaths()`: Helper that extracts paths from multi-module projects

**Features**:
- Supports single-module projects (returns base path)
- Supports multi-module projects (returns base path + all module content roots)
- Deduplicates paths automatically
- Handles project ID queries for specific projects
- Returns all open projects when no ID specified

**Integration**:
```kotlin
// Register with gRPC server during plugin initialization
val workspaceService = JetBrainsWorkspaceService()
grpcServer.addService(workspaceService)
```

### 2. JetBrainsWorkspaceListener.kt

**Purpose**: Listens to IntelliJ project lifecycle events and updates workspace metadata.

**Key Events**:
- `projectOpened()`: Initializes workspace metadata, associates tasks
- `projectClosed()`: Updates lastOpened timestamp
- `projectClosing()`: Pre-close cleanup (optional)

**Features**:
- Asynchronous event handling (doesn't block UI)
- Error handling and logging
- Preserves workspace metadata after project closure
- Links orphaned tasks to newly opened workspaces

**Integration**:
```kotlin
// Initialize during plugin startup
val listener = JetBrainsWorkspaceListener(controller, scope)
listener.initialize()
```

### 3. ClinePluginInitializer.kt

**Purpose**: Example initialization code showing how to wire everything together.

**Responsibilities**:
1. Create and register `JetBrainsWorkspaceService` with gRPC server
2. Initialize `JetBrainsWorkspaceListener` for lifecycle events
3. Trigger one-time workspace metadata migration
4. Initialize workspace metadata for currently open projects
5. Clean up resources on plugin disposal

**Usage**:
```kotlin
class ClinePluginService(private val project: Project) {
    private val initializer = ClinePluginInitializer(project)
    
    init {
        initializer.initialize(grpcServer, controller)
    }
    
    fun dispose() {
        initializer.dispose()
    }
}
```

## Dependencies

### Required IntelliJ Platform SDK Components:
- `com.intellij.openapi.project.Project`
- `com.intellij.openapi.project.ProjectManager`
- `com.intellij.openapi.project.ProjectManagerListener`
- `com.intellij.openapi.module.ModuleManager`
- `com.intellij.openapi.roots.ModuleRootManager`
- `com.intellij.openapi.application.ApplicationManager`

### Required gRPC Components:
- `io.grpc.stub.StreamObserver`
- Generated protobuf classes from `proto/host/workspace.proto`:
  - `WorkspaceServiceGrpc`
  - `GetWorkspacePathsRequest`
  - `GetWorkspacePathsResponse`

### Required Kotlin Coroutines:
- `kotlinx.coroutines.CoroutineScope`
- `kotlinx.coroutines.Dispatchers`
- `kotlinx.coroutines.SupervisorJob`
- `kotlinx.coroutines.launch`

## Integration Steps

### Step 1: Add Kotlin Files to Plugin

Copy the three `.kt` files to your JetBrains plugin codebase:
```
your-plugin/
└── src/main/kotlin/bot/cline/
    ├── host/
    │   ├── services/JetBrainsWorkspaceService.kt
    │   └── listeners/JetBrainsWorkspaceListener.kt
    └── plugin/ClinePluginInitializer.kt
```

### Step 2: Generate gRPC Stubs

Ensure the protobuf definitions from `proto/host/workspace.proto` are compiled to Kotlin:
```bash
# From Cline root directory
npm run protos
```

The generated Kotlin classes should be available in your plugin's classpath.

### Step 3: Integrate with Plugin Initialization

Modify your plugin's main service or component:

```kotlin
@Service
class ClinePluginService(private val project: Project) : Disposable {
    private val initializer = ClinePluginInitializer(project)
    
    init {
        // Initialize workspace tracking
        initializer.initialize(
            grpcServer = YourGrpcServer.getInstance(),
            controller = YourClineController.getInstance()
        )
    }
    
    override fun dispose() {
        initializer.dispose()
    }
}
```

### Step 4: Verify gRPC Communication

Test that the gRPC channel is working:

```kotlin
// In your test code
val request = GetWorkspacePathsRequest.newBuilder().build()
val response = workspaceService.getWorkspacePaths(request)
println("Workspace paths: ${response.pathsList}")
```

## Testing

### Unit Tests

**Test JetBrainsWorkspaceService**:
```kotlin
class JetBrainsWorkspaceServiceTest {
    @Test
    fun `getWorkspacePaths returns single project path`() {
        // Mock project with base path
        val project = mockProject("/path/to/project")
        
        // Call service
        val service = JetBrainsWorkspaceService()
        val response = captureResponse { observer ->
            service.getWorkspacePaths(
                GetWorkspacePathsRequest.newBuilder().build(),
                observer
            )
        }
        
        // Verify
        assertEquals(1, response.pathsCount)
        assertEquals("/path/to/project", response.pathsList[0])
    }
    
    @Test
    fun `getWorkspacePaths handles multi-module project`() {
        // Mock project with multiple modules
        val project = mockMultiModuleProject(
            basePath = "/path/to/project",
            modulePaths = listOf(
                "/path/to/project/module-a",
                "/path/to/project/module-b"
            )
        )
        
        // Verify all paths are included and deduplicated
        val response = captureResponse { observer ->
            service.getWorkspacePaths(
                GetWorkspacePathsRequest.newBuilder().build(),
                observer
            )
        }
        
        assertTrue(response.pathsList.contains("/path/to/project"))
        assertTrue(response.pathsList.contains("/path/to/project/module-a"))
        assertTrue(response.pathsList.contains("/path/to/project/module-b"))
    }
}
```

**Test JetBrainsWorkspaceListener**:
```kotlin
class JetBrainsWorkspaceListenerTest {
    @Test
    fun `projectOpened triggers workspace initialization`() {
        val controller = mockController()
        val listener = JetBrainsWorkspaceListener(controller, testScope)
        listener.initialize()
        
        // Trigger project open event
        val project = mockProject("/test/project")
        listener.projectOpened(project)
        
        // Verify controller methods were called
        verify(controller).initializeWorkspaceMetadata()
        verify(controller).associateTasksWithWorkspace("/test/project")
    }
}
```

### Integration Tests

**Test Full Workflow**:
1. Start IntelliJ with Cline plugin
2. Open a project
3. Verify workspace metadata is created in global state
4. Create a task
5. Verify task is associated with workspace
6. Open another project
7. Verify workspace filter dropdown shows both workspaces
8. Close a project
9. Verify workspace metadata is preserved with updated lastOpened

**Manual Test Checklist**:
- [ ] Open single-module project → workspace metadata created
- [ ] Open multi-module project → all modules tracked
- [ ] Open multiple projects → all workspaces listed
- [ ] Close project → metadata preserved
- [ ] Create task → associated with current workspace
- [ ] Switch projects → task associations maintained
- [ ] Restart IDE → workspace metadata persists
- [ ] Filter tasks by workspace → correct filtering
- [ ] View multi-workspace task → badges display
- [ ] Cross-workspace operation → warning shows

## Troubleshooting

### Service Not Registered

**Symptom**: `getWorkspacePaths()` not being called from TypeScript.

**Solution**: Verify gRPC service is registered:
```kotlin
// Check server has service
println(grpcServer.services)  // Should include WorkspaceService
```

### Events Not Firing

**Symptom**: Workspace metadata not updating when projects open/close.

**Solution**: Verify listener is registered:
```kotlin
// Check message bus connection
ApplicationManager.getApplication().messageBus
    .syncPublisher(ProjectManager.TOPIC)
    .projectOpened(project)  // Should trigger listener
```

### Duplicate Paths

**Symptom**: Workspace paths appearing multiple times.

**Solution**: Ensure `.distinct()` is called:
```kotlin
.addAllPaths(paths.distinct())  // Already in implementation
```

### Performance Issues

**Symptom**: UI blocking when projects open.

**Solution**: Ensure async execution:
```kotlin
scope.launch {  // All heavy operations in coroutine
    controller.initializeWorkspaceMetadata()
}
```

## Logging

All components include extensive logging for debugging:

```
[JetBrainsWorkspaceService] Returned 3 workspace path(s)
[JetBrainsWorkspaceListener] Project opened: MyProject at /path/to/project
[JetBrainsWorkspaceListener] Workspace metadata initialized for: MyProject
[ClinePlugin] Workspace tracking initialization complete!
```

Enable debug logging in IntelliJ:
```
Help > Diagnostic Tools > Debug Log Settings
Add: bot.cline
```

## Next Steps

1. Copy files to JetBrains plugin codebase
2. Adjust package names to match your plugin structure
3. Integrate with existing gRPC server and controller
4. Run unit tests
5. Test manually in IntelliJ IDE
6. Update documentation if API changes

## Support

For questions or issues:
- Review `JETBRAINS_WORKSPACE_IMPLEMENTATION.md` in project root
- Check `src/hosts/vscode/` for VSCode reference implementation
- Review `proto/host/workspace.proto` for gRPC contract
- Check `src/core/workspace/` for core TypeScript implementation

## Related Files

- **Core Logic**: `src/core/controller/workspace/`
- **VSCode Implementation**: `src/hosts/vscode/initializeWorkspace.ts`
- **Protocol Definition**: `proto/host/workspace.proto`
- **Documentation**: `JETBRAINS_WORKSPACE_IMPLEMENTATION.md`
