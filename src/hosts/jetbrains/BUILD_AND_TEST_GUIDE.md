# Building and Testing the JetBrains Extension Locally

This guide explains how to build and test the Cline JetBrains plugin locally, including how to integrate and test the workspace management features.

## Important Note

The Kotlin files in `src/hosts/jetbrains/` are **reference implementations** meant to be copied into the **separate JetBrains plugin repository**. The main Cline repository (`/Users/szymon/git/cline`) contains the TypeScript core, while the JetBrains plugin is a separate Kotlin/Java project.

## Prerequisites

### Required Software

1. **IntelliJ IDEA** (Community or Ultimate Edition)
   - Download: https://www.jetbrains.com/idea/download/
   - Minimum version: 2023.1 or later

2. **JDK 17 or later**
   ```bash
   # Check Java version
   java -version
   
   # If needed, install via Homebrew (macOS)
   brew install openjdk@17
   ```

3. **Gradle** (usually bundled with IntelliJ)
   ```bash
   # Check Gradle version (optional - IntelliJ uses wrapper)
   gradle --version
   ```

4. **Node.js** (for building TypeScript core)
   ```bash
   # Already installed if you're working with Cline
   node --version  # Should be 18+ or 20+
   ```

## Step 1: Locate the JetBrains Plugin Repository

### Option A: If the Plugin Repository Exists

The JetBrains plugin is typically in a separate repository. Check:

```bash
# Common locations:
ls ../cline-jetbrains/
ls ../jetbrains-plugin/
ls ../cline-intellij/

# Or search GitHub
open "https://github.com/cline/cline-jetbrains"
```

### Option B: If No Plugin Repository Exists

You'll need to create a new IntelliJ Plugin project:

1. Open IntelliJ IDEA
2. File → New → Project
3. Select "IntelliJ Platform Plugin"
4. Configure:
   - Name: `cline-jetbrains`
   - Location: `../cline-jetbrains/` (outside the main Cline repo)
   - Language: Kotlin
   - Build System: Gradle

## Step 2: Set Up the Plugin Project

### Project Structure

Your JetBrains plugin should have this structure:

```
cline-jetbrains/
├── build.gradle.kts          # Gradle build configuration
├── gradle.properties          # Plugin version, compatibility
├── settings.gradle.kts        # Project settings
├── src/
│   ├── main/
│   │   ├── kotlin/
│   │   │   └── bot/cline/
│   │   │       ├── host/
│   │   │       │   ├── services/
│   │   │       │   │   └── JetBrainsWorkspaceService.kt
│   │   │       │   └── listeners/
│   │   │       │       └── JetBrainsWorkspaceListener.kt
│   │   │       ├── plugin/
│   │   │       │   └── ClinePluginInitializer.kt
│   │   │       └── ... (other plugin code)
│   │   └── resources/
│   │       └── META-INF/
│   │           └── plugin.xml
│   └── test/
│       └── kotlin/
└── proto/                     # Protobuf definitions (symlink or copy)
```

### Sample `build.gradle.kts`

```kotlin
plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.9.21"
    id("org.jetbrains.intellij") version "1.16.1"
    id("com.google.protobuf") version "0.9.4"
}

group = "bot.cline"
version = "1.0.0"

repositories {
    mavenCentral()
}

dependencies {
    // Kotlin coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    
    // gRPC and protobuf
    implementation("io.grpc:grpc-netty:1.59.0")
    implementation("io.grpc:grpc-protobuf:1.59.0")
    implementation("io.grpc:grpc-stub:1.59.0")
    implementation("io.grpc:grpc-kotlin-stub:1.4.0")
    implementation("com.google.protobuf:protobuf-kotlin:3.25.0")
    
    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.mockito:mockito-core:5.7.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
}

intellij {
    version.set("2023.1.5")
    type.set("IC") // IC = Community, IU = Ultimate
    plugins.set(listOf())
}

tasks {
    withType<JavaCompile> {
        sourceCompatibility = "17"
        targetCompatibility = "17"
    }
    
    withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
        kotlinOptions.jvmTarget = "17"
    }
    
    patchPluginXml {
        sinceBuild.set("231")
        untilBuild.set("241.*")
    }
    
    signPlugin {
        certificateChain.set(System.getenv("CERTIFICATE_CHAIN"))
        privateKey.set(System.getenv("PRIVATE_KEY"))
        password.set(System.getenv("PRIVATE_KEY_PASSWORD"))
    }
    
    publishPlugin {
        token.set(System.getenv("PUBLISH_TOKEN"))
    }
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:3.25.0"
    }
    plugins {
        id("grpc") {
            artifact = "io.grpc:protoc-gen-grpc-java:1.59.0"
        }
        id("grpckt") {
            artifact = "io.grpc:protoc-gen-grpc-kotlin:1.4.0:jdk8@jar"
        }
    }
    generateProtoTasks {
        all().forEach {
            it.plugins {
                id("grpc")
                id("grpckt")
            }
            it.builtins {
                id("kotlin")
            }
        }
    }
}
```

### Sample `plugin.xml`

```xml
<idea-plugin>
    <id>bot.cline.jetbrains</id>
    <name>Cline</name>
    <vendor email="support@cline.bot" url="https://cline.bot">Cline</vendor>
    
    <description><![CDATA[
        Cline AI coding assistant for JetBrains IDEs.
        Provides intelligent code completion, refactoring, and workspace management.
    ]]></description>
    
    <depends>com.intellij.modules.platform</depends>
    
    <extensions defaultExtensionNs="com.intellij">
        <!-- Tool window -->
        <toolWindow id="Cline" 
                    anchor="right" 
                    factoryClass="bot.cline.ui.ClineToolWindowFactory"/>
        
        <!-- Services -->
        <projectService serviceImplementation="bot.cline.plugin.ClinePluginService"/>
    </extensions>
    
    <projectListeners>
        <!-- Workspace listener is registered programmatically -->
    </projectListeners>
</idea-plugin>
```

## Step 3: Copy Workspace Implementation Files

Copy the workspace management files from the main Cline repo:

```bash
# Navigate to the JetBrains plugin directory
cd ../cline-jetbrains/

# Copy Kotlin implementation files
mkdir -p src/main/kotlin/bot/cline/host/services
mkdir -p src/main/kotlin/bot/cline/host/listeners
mkdir -p src/main/kotlin/bot/cline/plugin

cp ../cline/src/hosts/jetbrains/JetBrainsWorkspaceService.kt \
   src/main/kotlin/bot/cline/host/services/

cp ../cline/src/hosts/jetbrains/JetBrainsWorkspaceListener.kt \
   src/main/kotlin/bot/cline/host/listeners/

cp ../cline/src/hosts/jetbrains/ClinePluginInitializer.kt \
   src/main/kotlin/bot/cline/plugin/

# Copy or symlink proto files
ln -s ../cline/proto proto
```

## Step 4: Build the TypeScript Core

The TypeScript core needs to be built and packaged for the JetBrains plugin:

```bash
# In the main Cline repository
cd /Users/szymon/git/cline

# Build TypeScript core
npm install
npm run compile

# Generate gRPC proto files
npm run protos

# Build standalone distribution (includes Node.js runtime)
npm run package-standalone

# The output will be in dist-standalone/
ls -la dist-standalone/
```

## Step 5: Build the JetBrains Plugin

```bash
# Navigate to plugin directory
cd ../cline-jetbrains/

# Clean previous builds
./gradlew clean

# Build the plugin
./gradlew buildPlugin

# Output will be in build/distributions/
ls -la build/distributions/*.zip
```

### Build Options

```bash
# Build with specific IntelliJ version
./gradlew buildPlugin -PintellijVersion=2023.2.5

# Build and run in sandbox IDE
./gradlew runIde

# Build and run with specific project open
./gradlew runIde -PtestProject=/path/to/test/project

# Build with debug enabled
./gradlew runIde --debug-jvm
```

## Step 6: Testing Locally

### Option A: Run in Sandbox IDE (Recommended)

This launches a separate IntelliJ instance with the plugin installed:

```bash
cd ../cline-jetbrains/

# Run plugin in sandbox IDE
./gradlew runIde

# This will:
# 1. Compile the plugin
# 2. Launch a new IntelliJ IDEA instance
# 3. Install the plugin in that instance
# 4. You can test in a safe environment
```

### Option B: Install Built Plugin

```bash
# Build the plugin
./gradlew buildPlugin

# Install in IntelliJ:
# 1. Open IntelliJ IDEA
# 2. Settings → Plugins
# 3. Click gear icon → Install Plugin from Disk
# 4. Select: build/distributions/cline-jetbrains-1.0.0.zip
# 5. Restart IntelliJ
```

### Option C: Debug Mode

For debugging with breakpoints:

```bash
# Run with debug port open
./gradlew runIde --debug-jvm

# In another IntelliJ instance:
# Run → Edit Configurations
# + → Remote JVM Debug
# Host: localhost
# Port: 5005 (default)
# Click Debug
```

## Step 7: Testing Workspace Features

### Test Checklist

Once the plugin is running:

1. **Open a Project**
   ```
   - Open a single-module project
   - Check IntelliJ logs: View → Tool Windows → Cline Debug Console
   - Should see: "[JetBrainsWorkspaceListener] Project opened: ProjectName"
   - Verify workspace metadata created in global state
   ```

2. **Check Workspace Paths**
   ```
   - Open Cline tool window (View → Tool Windows → Cline)
   - Open Cline debug panel
   - Execute: Call getWorkspacePaths()
   - Should return project base path
   ```

3. **Test Multi-Module Project**
   ```
   - Open a Gradle/Maven multi-module project
   - Verify all module paths are detected
   - Check logs for: "Added module content root: /path/to/module"
   ```

4. **Test Multiple Projects**
   ```
   - Open multiple project windows (File → Open in New Window)
   - Verify each project tracked separately
   - Check workspace filter dropdown shows all projects
   ```

5. **Test Task Association**
   ```
   - Create a new Cline task
   - Verify task associated with current project
   - Check task history (View → Cline → History)
   - Should show workspace badge next to task
   ```

6. **Test Project Close**
   ```
   - Close a project
   - Check logs: "[JetBrainsWorkspaceListener] Project closed: ProjectName"
   - Verify metadata preserved (not deleted)
   - Verify lastOpened timestamp updated
   ```

7. **Test Cross-Workspace Warning**
   ```
   - Open Project A, create task
   - Switch to Project B
   - Try to continue task from Project A
   - Should show cross-workspace warning modal
   ```

### Viewing Logs

```bash
# IntelliJ log file location
# macOS:
tail -f ~/Library/Logs/JetBrainsIDEA*/idea.log

# Linux:
tail -f ~/.cache/JetBrains/IntelliJIdea*/log/idea.log

# Windows:
Get-Content $env:APPDATA\JetBrains\IntelliJIdea*\log\idea.log -Wait

# Or in IDE:
# Help → Show Log in Finder/Explorer
```

### Debug Logging

Enable detailed logging:

```
# In IntelliJ:
Help → Diagnostic Tools → Debug Log Settings

# Add these categories:
bot.cline
#bot.cline.host.services.JetBrainsWorkspaceService:trace
#bot.cline.host.listeners.JetBrainsWorkspaceListener:trace
```

## Step 8: Running Unit Tests

### Create Test File

```kotlin
// src/test/kotlin/bot/cline/host/services/JetBrainsWorkspaceServiceTest.kt
package bot.cline.host.services

import com.intellij.openapi.project.Project
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import io.grpc.stub.StreamObserver
import org.junit.Test
import org.mockito.Mockito.*

class JetBrainsWorkspaceServiceTest : BasePlatformTestCase() {
    
    @Test
    fun testGetWorkspacePathsReturnsProjectPath() {
        // Arrange
        val service = JetBrainsWorkspaceService()
        val request = GetWorkspacePathsRequest.newBuilder().build()
        val responseObserver = mock(StreamObserver::class.java) as StreamObserver<GetWorkspacePathsResponse>
        
        // Act
        service.getWorkspacePaths(request, responseObserver)
        
        // Assert
        verify(responseObserver).onNext(any())
        verify(responseObserver).onCompleted()
    }
}
```

### Run Tests

```bash
# Run all tests
./gradlew test

# Run specific test class
./gradlew test --tests "JetBrainsWorkspaceServiceTest"

# Run with coverage
./gradlew test jacocoTestReport

# View results
open build/reports/tests/test/index.html
open build/reports/jacoco/test/html/index.html
```

## Troubleshooting

### Plugin Not Loading

**Symptom**: Plugin doesn't appear in IntelliJ after installation

**Solutions**:
```bash
# Check plugin.xml is valid
xmllint src/main/resources/META-INF/plugin.xml

# Check build output
cat build/distributions/cline-jetbrains-1.0.0.zip | grep plugin.xml

# Check IntelliJ compatibility
# In plugin.xml, ensure sinceBuild/untilBuild match your IDE version
```

### gRPC Not Working

**Symptom**: TypeScript core can't call Kotlin service

**Solutions**:
```kotlin
// Verify gRPC server is running
println("gRPC server listening on port: ${grpcServer.port}")

// Test service registration
println("Services: ${grpcServer.services.map { it.serviceDescriptor.name }}")

// Should see: "host.WorkspaceService"
```

### Workspace Listener Not Firing

**Symptom**: No logs when opening/closing projects

**Solutions**:
```kotlin
// Verify listener is registered
ApplicationManager.getApplication().messageBus
    .syncPublisher(ProjectManager.TOPIC)
    .projectOpened(project)  // Manually trigger for testing

// Check connection is not disposed
val connection = ApplicationManager.getApplication().messageBus.connect()
println("Connection disposed: ${connection.isDisposed}")
```

### Build Errors

**Common errors and fixes**:

```bash
# Error: "Unresolved reference: grpc"
# Fix: Ensure protobuf plugin is applied
./gradlew --refresh-dependencies

# Error: "Could not find IntelliJ SDK"
# Fix: Update intellij plugin version in build.gradle.kts
./gradlew --refresh-dependencies

# Error: "Kotlin version mismatch"
# Fix: Sync Kotlin version with IntelliJ
# Check: Settings → Build → Kotlin
```

## Integration Testing Workflow

### Complete Test Flow

```bash
# 1. Build TypeScript core
cd /Users/szymon/git/cline
npm run compile
npm run protos

# 2. Build JetBrains plugin
cd ../cline-jetbrains
./gradlew clean buildPlugin

# 3. Run in sandbox
./gradlew runIde

# 4. In sandbox IDE:
#    - Open a test project
#    - Open Cline tool window
#    - Create a task
#    - Verify workspace badge appears
#    - Open another project window
#    - Verify workspace filter shows both projects
#    - Close one project
#    - Verify workspace metadata preserved

# 5. Check logs
tail -f ~/Library/Logs/JetBrainsIDEA*/idea.log | grep -i cline
```

## Continuous Development

### Watch Mode (TypeScript)

```bash
# In main Cline repo - auto-rebuild on changes
cd /Users/szymon/git/cline
npm run watch
```

### Auto-Reload Plugin

```kotlin
// In plugin code, add development mode helper
object DevMode {
    fun isDevMode() = System.getProperty("idea.plugin.in.sandbox.mode") == "true"
    
    fun log(message: String) {
        if (isDevMode()) {
            println("[DEV] $message")
        }
    }
}
```

## Publishing (Future)

Once testing is complete:

```bash
# Build release version
./gradlew buildPlugin -PpluginVersion=1.0.0

# Sign plugin (requires certificate)
./gradlew signPlugin

# Publish to JetBrains Marketplace
./gradlew publishPlugin
```

## Additional Resources

- **IntelliJ Platform SDK**: https://plugins.jetbrains.com/docs/intellij/
- **Kotlin Plugin Development**: https://plugins.jetbrains.com/docs/intellij/using-kotlin.html
- **gRPC Kotlin**: https://grpc.io/docs/languages/kotlin/
- **JetBrains Marketplace**: https://plugins.jetbrains.com/

## Need Help?

If you encounter issues:
1. Check IntelliJ logs (Help → Show Log)
2. Enable debug logging for bot.cline package
3. Review `src/hosts/jetbrains/README.md` for implementation details
4. Check Cline TypeScript core logs
5. Verify gRPC connectivity between Kotlin and TypeScript

## Next Steps

After successful local testing:
1. Create unit tests for workspace features
2. Add integration tests
3. Document any plugin-specific configuration
4. Prepare for release to JetBrains Marketplace
