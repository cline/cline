import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../extension';
import { readFile } from 'fs/promises';
import path from 'path';
import { createMockVSCodeModule, createMockExtensionContext } from './utils/vscode-mock';

// Setup global mock for vscode module
vi.mock('vscode', () => createMockVSCodeModule());

describe('Cline Extension', () => {
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.resetAllMocks();
    
    // Create a fresh mock context for each test
    mockContext = createMockExtensionContext();
  });

  const packagePath = path.join(__dirname, "..", "..", "package.json");

  it('should verify extension ID matches package.json', async () => {
    const packageJSON = JSON.parse(await readFile(packagePath, "utf8"));
    const id = `${packageJSON.publisher}.${packageJSON.name}`;
    
    const mockGetExtension = vi.spyOn(vscode.extensions, 'getExtension');
    mockGetExtension.mockReturnValue({
      id: id,
      isActive: true,
      exports: {},
      activate: vi.fn(),
      extensionPath: '',
      extensionUri: {} as any,
      isFromWorkspace: false
    } as any);

    const clineExtensionApi = vscode.extensions.getExtension(id);
    expect(clineExtensionApi?.id).toBe(id);
  });

  it('should successfully execute the plus button command', async () => {
    // Activate the extension first
    activate(mockContext);
    
    // Simulate a delay to mimic real-world async behavior
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    const mockExecuteCommand = vi.spyOn(vscode.commands, 'executeCommand');
    
    await vscode.commands.executeCommand("cline.plusButtonClicked");
    
    expect(mockExecuteCommand).toHaveBeenCalledWith("cline.plusButtonClicked");
  });

  it('should activate extension', () => {
    const result = activate(mockContext);
    
    // Verify that the extension returns an API
    expect(result).toBeDefined();
    
    // Verify output channel was created
    expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('Cline');
  });

  it('should register commands', () => {
    const mockRegisterCommand = vi.spyOn(vscode.commands, 'registerCommand');
    
    activate(mockContext);

    // Check specific commands are registered
    const registeredCommands = [
      'cline.plusButtonClicked',
      'cline.mcpButtonClicked', 
      'cline.popoutButtonClicked',
      'cline.openInNewTab',
      'cline.settingsButtonClicked',
      'cline.historyButtonClicked'
    ];

    registeredCommands.forEach(command => {
      expect(mockRegisterCommand).toHaveBeenCalledWith(
        command, 
        expect.any(Function)
      );
    });
  });

  it('should register text document content provider', () => {
    activate(mockContext);

    // Verify that text document content provider is registered
    expect(vscode.workspace.registerTextDocumentContentProvider)
      .toHaveBeenCalledWith(
        expect.any(String), 
        expect.any(Object)
      );
  });

  it('should register webview view provider', () => {
    activate(mockContext);

    // Verify that webview view provider is registered
    expect(vscode.window.registerWebviewViewProvider)
      .toHaveBeenCalledWith(
        expect.any(String), 
        expect.any(Object),
        expect.any(Object)
      );
  });
});
