# Creating Cline Plugin Extensions

## Overview

Cline plugins are VS Code extensions that extend Cline's capabilities by registering custom tools and functions. This guide shows you how to create plugins that integrate with other VS Code extensions' APIs, using Python environment intelligence as a practical example.

## Why Create Cline Plugins?

Cline plugins bridge the gap between VS Code extensions and Cline's AI capabilities. Common use cases:

- **Environment Intelligence**: Access runtime environment data (Python interpreters, Node versions, etc.)
- **Tool Integration**: Connect Cline to language servers, debuggers, test runners
- **External APIs**: Integrate third-party services (databases, cloud providers, etc.)
- **Custom Workflows**: Add domain-specific operations tailored to your team

## Quick Start

### 1. Prerequisites

- Node.js 18+ and npm
- VS Code 1.84+
- Basic TypeScript knowledge
- Cline extension installed

### 2. Create Your Extension

```bash
npm install -g yo generator-code
yo code

# Choose: New Extension (TypeScript)
# Extension name: cline-python-env
# Description: Python environment intelligence for Cline
# Initialize git: Yes
```

### 3. Add Cline as Dependency

Edit `package.json`:

```json
{
  "name": "cline-python-env",
  "displayName": "Cline Python Environment Plugin",
  "version": "0.1.0",
  "engines": {
    "vscode": "^1.84.0"
  },
  "extensionDependencies": [
    "saoudrizwan.claude-dev"
  ],
  "dependencies": {
    "@vscode/python-extension": "^1.0.5"
  }
}
```

### 4. Install Dependencies

```bash
npm install @vscode/python-extension
```

## Plugin Structure

### Core Interface

Every Cline plugin must implement the `ClinePlugin` interface:

```typescript
interface ClinePlugin {
  // Unique identifier (use your extension ID)
  readonly id: string
  
  // Display name
  readonly name: string
  
  // Semantic version
  readonly version: string
  
  // Optional description
  readonly description?: string
  
  // Return available capabilities/tools
  getCapabilities(): Promise<PluginCapability[]>
  
  // Execute a specific capability
  executeCapability(
    capabilityName: string,
    parameters: Record<string, any>,
    context: PluginContext
  ): Promise<any>
  
  // Optional cleanup
  dispose?(): Promise<void>
}
```

### Capability Definition

Each tool/function your plugin provides:

```typescript
interface PluginCapability {
  // Unique capability name (within your plugin)
  name: string
  
  // Description for the LLM
  description: string
  
  // Parameter definitions
  parameters: ParameterDefinition[]
  
  // Optional return type description
  returns?: string
  
  // Optional usage guidance for the LLM
  prompt?: string
  
  // Optional usage examples
  examples?: string[]
}

interface ParameterDefinition {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required: boolean
  description?: string
  defaultValue?: any
}
```

### Plugin Context

Your plugin receives a limited context for security:

```typescript
interface PluginContext {
  // Current task information
  taskId: string
  taskMode: 'plan' | 'act'
  workingDirectory: string
  
  // Safe services
  logger: PluginLogger      // Scoped logging
  storage: PluginStorage    // Plugin-specific storage
  http: PluginHttpClient    // Rate-limited HTTP
  
  // Communication methods
  notify(message: string): void
  requestInput(prompt: string): Promise<string>
}
```

## Complete Example: Python Environment Plugin

This plugin integrates with the VS Code Python extension to provide environment intelligence.

### src/plugin.ts

```typescript
import * as vscode from 'vscode'
import { PythonExtension } from '@vscode/python-extension'
import { ClinePlugin, PluginCapability, PluginContext } from './types'

export class PythonEnvPlugin implements ClinePlugin {
  readonly id = 'cline-python-env'
  readonly name = 'Python Environment Intelligence'
  readonly version = '1.0.0'
  readonly description = 'Provides Python environment and package information'
  
  private pythonApi?: Awaited<ReturnType<typeof PythonExtension.api>>
  
  async initialize() {
    // Get Python extension API
    this.pythonApi = await PythonExtension.api()
  }
  
  async getCapabilities(): Promise<PluginCapability[]> {
    return [
      {
        name: 'getPythonEnvironment',
        description: 'Get detailed information about the active Python environment including version, installed packages, and environment type',
        parameters: [],
        returns: 'Environment details including Python version, environment type, installed packages with versions, and environment path',
        prompt: 'Use this to understand what Python packages are available before suggesting code. Check package versions to generate compatible code.',
        examples: [
          'Get the current Python environment to check if TensorFlow is installed',
          'Check Python version before using version-specific syntax',
          'Verify pandas version before generating DataFrame code'
        ]
      },
      {
        name: 'getPythonVersion',
        description: 'Get the Python version of the active environment',
        parameters: [],
        returns: 'Python version string (e.g., "3.11.2")'
      },
      {
        name: 'checkPackageInstalled',
        description: 'Check if a specific package is installed and get its version',
        parameters: [
          {
            name: 'packageName',
            type: 'string',
            required: true,
            description: 'Name of the package to check (e.g., "pandas", "tensorflow")'
          }
        ],
        returns: 'Package version if installed, null if not installed',
        examples: [
          'Check if numpy is installed before suggesting array operations',
          'Verify Django version to generate compatible view code'
        ]
      },
      {
        name: 'getInstallCommand',
        description: 'Get the appropriate package installation command for the current environment type',
        parameters: [
          {
            name: 'packageName',
            type: 'string',
            required: true,
            description: 'Name of the package to install'
          },
          {
            name: 'version',
            type: 'string',
            required: false,
            description: 'Optional specific version (e.g., "2.0.0")'
          }
        ],
        returns: 'Installation command appropriate for the environment (pip, conda, poetry, etc.)',
        prompt: 'Use this to provide correct installation commands. Different environments (venv, conda, poetry) require different commands.'
      }
    ]
  }
  
  async executeCapability(
    capabilityName: string,
    parameters: Record<string, any>,
    context: PluginContext
  ): Promise<any> {
    if (!this.pythonApi) {
      throw new Error('Python extension API not available')
    }
    
    context.logger.info(`Executing ${capabilityName}`, { parameters })
    
    switch (capabilityName) {
      case 'getPythonEnvironment':
        return await this.getPythonEnvironment(context)
        
      case 'getPythonVersion':
        return await this.getPythonVersion(context)
        
      case 'checkPackageInstalled':
        return await this.checkPackageInstalled(
          parameters.packageName as string,
          context
        )
        
      case 'getInstallCommand':
        return await this.getInstallCommand(
          parameters.packageName as string,
          parameters.version as string | undefined,
          context
        )
        
      default:
        throw new Error(`Unknown capability: ${capabilityName}`)
    }
  }
  
  // Core implementation: resolveEnvironment()
  private async getPythonEnvironment(context: PluginContext) {
    try {
      // Get active environment path
      const envPath = this.pythonApi!.environments.getActiveEnvironmentPath()
      context.logger.debug('Active environment path', { path: envPath.path })
      
      // Resolve full environment details - THE KEY FUNCTION!
      const envDetails = await this.pythonApi!.environments.resolveEnvironment(envPath)
      
      if (!envDetails) {
        return {
          error: 'Could not resolve Python environment',
          path: envPath.path
        }
      }
      
      // Extract and format relevant information
      const result = {
        path: envPath.path,
        version: envDetails.version?.major && envDetails.version?.minor && envDetails.version?.micro
          ? `${envDetails.version.major}.${envDetails.version.minor}.${envDetails.version.micro}`
          : 'unknown',
        environmentType: this.detectEnvironmentType(envPath.path),
        packages: this.formatPackages(envDetails),
        pythonExecutable: envDetails.executable?.uri?.fsPath || envPath.path
      }
      
      context.logger.info('Environment resolved successfully', { 
        version: result.version,
        packageCount: result.packages.length 
      })
      
      return result
    } catch (error) {
      context.logger.error('Failed to get Python environment', { error })
      throw new Error(`Failed to resolve Python environment: ${error}`)
    }
  }
  
  private async getPythonVersion(context: PluginContext) {
    const env = await this.getPythonEnvironment(context)
    return env.version
  }
  
  private async checkPackageInstalled(
    packageName: string,
    context: PluginContext
  ) {
    const env = await this.getPythonEnvironment(context)
    const pkg = env.packages.find(
      p => p.name.toLowerCase() === packageName.toLowerCase()
    )
    
    if (pkg) {
      context.logger.info(`Package ${packageName} found`, { version: pkg.version })
      return pkg.version
    }
    
    context.logger.info(`Package ${packageName} not found`)
    return null
  }
  
  private async getInstallCommand(
    packageName: string,
    version: string | undefined,
    context: PluginContext
  ) {
    const env = await this.getPythonEnvironment(context)
    const packageSpec = version ? `${packageName}==${version}` : packageName
    
    // Detect environment type and return appropriate command
    switch (env.environmentType) {
      case 'conda':
        return `conda install ${packageSpec}`
      case 'poetry':
        return version 
          ? `poetry add ${packageName}@${version}` 
          : `poetry add ${packageName}`
      case 'pipenv':
        return `pipenv install ${packageSpec}`
      case 'venv':
      case 'virtualenv':
        return `pip install ${packageSpec}`
      default:
        // System Python - recommend user flag
        context.notify('Using system Python - consider creating a virtual environment')
        return `pip install --user ${packageSpec}`
    }
  }
  
  // Helper methods
  private detectEnvironmentType(path: string): string {
    if (path.includes('conda') || path.includes('miniconda') || path.includes('anaconda')) {
      return 'conda'
    } else if (path.includes('poetry')) {
      return 'poetry'
    } else if (path.includes('pipenv')) {
      return 'pipenv'
    } else if (path.includes('.venv') || path.includes('venv')) {
      return 'venv'
    } else if (path.includes('virtualenv')) {
      return 'virtualenv'
    } else {
      return 'system'
    }
  }
  
  private formatPackages(envDetails: any): Array<{ name: string; version: string }> {
    // Note: The actual structure depends on the Python extension API version
    // This is a simplified example
    const packages: Array<{ name: string; version: string }> = []
    
    // Extract packages from environment details
    // The exact property path may vary - check Python extension docs
    if (envDetails.packages) {
      for (const pkg of envDetails.packages) {
        packages.push({
          name: pkg.name || 'unknown',
          version: pkg.version || 'unknown'
        })
      }
    }
    
    return packages
  }
  
  async dispose() {
    // Cleanup if needed
    this.pythonApi = undefined
  }
}
```

### src/extension.ts

```typescript
import * as vscode from 'vscode'
import { PythonEnvPlugin } from './plugin'

export async function activate(context: vscode.ExtensionContext) {
  console.log('Python Environment Plugin activating...')
  
  // Get Cline API
  const clineExtension = vscode.extensions.getExtension('saoudrizwan.claude-dev')
  
  if (!clineExtension) {
    vscode.window.showErrorMessage('Cline extension not found')
    return
  }
  
  // Activate Cline if not already active
  if (!clineExtension.isActive) {
    await clineExtension.activate()
  }
  
  const clineApi = clineExtension.exports
  
  if (!clineApi || !clineApi.plugins) {
    vscode.window.showErrorMessage('Cline plugin API not available')
    return
  }
  
  // Create and register plugin
  const plugin = new PythonEnvPlugin()
  await plugin.initialize()
  
  try {
    await clineApi.plugins.registerPlugin(plugin)
    console.log('Python Environment Plugin registered successfully')
    
    // Cleanup on deactivation
    context.subscriptions.push({
      dispose: async () => {
        await plugin.dispose()
        await clineApi.plugins.unregisterPlugin(plugin.id)
      }
    })
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to register plugin: ${error}`)
  }
}

export function deactivate() {
  console.log('Python Environment Plugin deactivated')
}
```

### src/types.ts

```typescript
// Type definitions for Cline plugin interface
// (These would typically be provided by Cline or installed from npm)

export interface ClinePlugin {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly description?: string
  getCapabilities(): Promise<PluginCapability[]>
  executeCapability(
    capabilityName: string,
    parameters: Record<string, any>,
    context: PluginContext
  ): Promise<any>
  dispose?(): Promise<void>
}

export interface PluginCapability {
  name: string
  description: string
  parameters: ParameterDefinition[]
  returns?: string
  prompt?: string
  examples?: string[]
}

export interface ParameterDefinition {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required: boolean
  description?: string
  defaultValue?: any
}

export interface PluginContext {
  taskId: string
  taskMode: 'plan' | 'act'
  workingDirectory: string
  logger: PluginLogger
  storage: PluginStorage
  http: PluginHttpClient
  notify(message: string): void
  requestInput(prompt: string): Promise<string>
}

export interface PluginLogger {
  debug(message: string, data?: any): void
  info(message: string, data?: any): void
  warn(message: string, data?: any): void
  error(message: string, data?: any): void
}

export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

export interface PluginHttpClient {
  get(url: string, options?: RequestOptions): Promise<HttpResponse>
  post(url: string, data?: any, options?: RequestOptions): Promise<HttpResponse>
}

export interface RequestOptions {
  headers?: Record<string, string>
  timeout?: number
}

export interface HttpResponse {
  status: number
  data: any
  headers: Record<string, string>
}
```

## How the Plugin Works

### 1. Registration Flow

```
Extension Activates
    ↓
Get Cline Extension API
    ↓
Create Plugin Instance
    ↓
Call initialize() (get Python API)
    ↓
Register with Cline
    ↓
Plugin Available to LLM
```

### 2. Execution Flow

```
User asks: "Check if pandas is installed"
    ↓
LLM generates: plugin_execute tool call
    ↓
Cline routes to your plugin
    ↓
executeCapability('checkPackageInstalled', {packageName: 'pandas'})
    ↓
Your code calls resolveEnvironment()
    ↓
Return result to LLM
    ↓
LLM uses result in response
```

### 3. What the LLM Sees

When your plugin is registered, Cline adds it to the system prompt:

```
# Plugin Extensions

## Python Environment Intelligence (cline-python-env)
Provides Python environment and package information

### Available Capabilities:

**getPythonEnvironment**
Description: Get detailed information about the active Python environment including 
version, installed packages, and environment type

Usage: Use this to understand what Python packages are available before suggesting code. 
Check package versions to generate compatible code.

Examples:
- Get the current Python environment to check if TensorFlow is installed
- Check Python version before using version-specific syntax
- Verify pandas version before generating DataFrame code

Returns: Environment details including Python version, environment type, installed 
packages with versions, and environment path

**checkPackageInstalled**
Description: Check if a specific package is installed and get its version

Parameters:
- packageName (string, required): Name of the package to check

Returns: Package version if installed, null if not installed

[... other capabilities ...]
```

## Best Practices

### 1. Error Handling

Always handle errors gracefully:

```typescript
async executeCapability(name: string, params: any, context: PluginContext) {
  try {
    // Your logic
    const result = await this.doSomething(params)
    return result
  } catch (error) {
    // Log the error
    context.logger.error(`Failed to execute ${name}`, { error, params })
    
    // Return user-friendly error
    throw new Error(
      `Failed to ${name}: ${error.message}. ` +
      `Please check that the required extension is installed.`
    )
  }
}
```

### 2. Validate Parameters

```typescript
private validatePackageName(name: string) {
  if (!name || typeof name !== 'string') {
    throw new Error('Package name must be a non-empty string')
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error('Invalid package name format')
  }
}
```

### 3. Use Context Logging

```typescript
async getPythonEnvironment(context: PluginContext) {
  context.logger.info('Fetching Python environment')
  
  const start = Date.now()
  const result = await this.pythonApi.environments.resolveEnvironment(path)
  
  context.logger.debug('Environment resolved', { 
    duration: Date.now() - start,
    packageCount: result.packages?.length 
  })
  
  return result
}
```

### 4. Cache Expensive Operations

```typescript
private envCache?: {
  path: string
  data: any
  timestamp: number
}

async getPythonEnvironment(context: PluginContext) {
  const envPath = this.pythonApi!.environments.getActiveEnvironmentPath()
  
  // Check cache (5 minute expiry)
  if (this.envCache && 
      this.envCache.path === envPath.path &&
      Date.now() - this.envCache.timestamp < 300000) {
    context.logger.debug('Using cached environment data')
    return this.envCache.data
  }
  
  // Fetch fresh data
  const data = await this.pythonApi!.environments.resolveEnvironment(envPath)
  
  this.envCache = {
    path: envPath.path,
    data,
    timestamp: Date.now()
  }
  
  return data
}
```

### 5. Provide Helpful Prompts

Guide the LLM on when and how to use your capabilities:

```typescript
{
  name: 'checkPackageInstalled',
  description: 'Check if a specific package is installed',
  prompt: `
    IMPORTANT: Always check if packages are installed before suggesting code that uses them.
    
    Examples of when to use:
    - Before generating import statements
    - When user mentions a package name
    - Before suggesting package-specific solutions
    
    If package is not installed, suggest the installation command using getInstallCommand.
  `,
  parameters: [...]
}
```

## Testing Your Plugin

### 1. Unit Tests

```typescript
// test/plugin.test.ts
import { PythonEnvPlugin } from '../src/plugin'
import { PluginContext } from '../src/types'

describe('PythonEnvPlugin', () => {
  let plugin: PythonEnvPlugin
  let mockContext: PluginContext
  
  beforeEach(() => {
    plugin = new PythonEnvPlugin()
    mockContext = createMockContext()
  })
  
  it('should detect conda environment', () => {
    const path = '/Users/test/miniconda3/envs/myenv/bin/python'
    const type = plugin['detectEnvironmentType'](path)
    expect(type).toBe('conda')
  })
  
  it('should handle missing package', async () => {
    // Mock Python API response
    mockPythonApi.environments.resolveEnvironment.mockResolvedValue({
      packages: []
    })
    
    const result = await plugin.executeCapability(
      'checkPackageInstalled',
      { packageName: 'nonexistent' },
      mockContext
    )
    
    expect(result).toBeNull()
  })
})
```

### 2. Integration Testing

Test with Cline running:

1. Install your extension in development mode (`F5` in VS Code)
2. Ask Cline: "What Python packages do I have installed?"
3. Check Cline calls your plugin
4. Verify the response is useful

### 3. Debug Logging

Enable verbose logging in your plugin:

```typescript
if (process.env.DEBUG === 'true') {
  context.logger.debug('Full environment details', { envDetails })
}
```

## Publishing Your Plugin

### 1. Prepare for Publication

Update `package.json`:

```json
{
  "name": "cline-python-env",
  "displayName": "Cline Python Environment Plugin",
  "description": "Provides Python environment intelligence to Cline",
  "version": "1.0.0",
  "publisher": "your-username",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-username/cline-python-env"
  },
  "keywords": ["cline", "python", "environment", "plugin"],
  "categories": ["Other"],
  "icon": "icon.png"
}
```

### 2. Add Documentation

Create `README.md`:

```markdown
# Cline Python Environment Plugin

Provides Python environment intelligence to Cline, enabling it to understand
your Python setup and generate more accurate code.

## Features

- Detect Python version and environment type
- Check installed packages and versions
- Generate correct installation commands
- Provide environment-aware code suggestions

## Usage

Install this extension, then ask Cline questions like:
- "What Python packages do I have installed?"
- "Check if TensorFlow is installed"
- "What version of pandas am I using?"

Cline will automatically use this plugin to provide accurate information.

## Requirements

- Cline extension installed
- Python extension for VS Code installed
```

### 3. Publish

```bash
# Install vsce
npm install -g vsce

# Package extension
vsce package

# Publish to marketplace
vsce publish
```

## Troubleshooting

### Plugin Not Registering

**Problem**: Plugin doesn't appear in Cline

**Solutions**:
1. Check `extensionDependencies` includes Cline
2. Verify Cline is active before registration
3. Check console for error messages
4. Ensure plugin implements all required methods

### API Not Available

**Problem**: External extension API returns undefined

**Solutions**:
1. Check external extension is installed
2. Ensure external extension activated first
3. Add activation event: `"onLanguage:python"`
4. Wait for activation: `await extension.activate()`

### Execution Timeouts

**Problem**: Plugin operations take too long

**Solutions**:
1. Cache expensive operations
2. Make operations asynchronous
3. Add progress notifications
4. Implement timeouts with
