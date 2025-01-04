import { afterEach, describe, expect, test, vi } from 'vitest';
import { workspace, window } from 'vscode';
import { activate, deactivate } from './extension';

vi.mock('vscode', async () => {
  const vscode = (await import('jest-mock-vscode')).createVSCodeMock(vi);
  vscode.window.createOutputChannel = vi.fn().mockReturnValue({
    appendLine: vi.fn(),
  });
  return vscode;
});

describe('VSCode Extension', () => {
  console.log('describe: VSCode Extension');
  afterEach(() => {
    vi.resetAllMocks();
  });

  test('extension activates', () => {
    console.log('test: extension activates');
    const context = {
      subscriptions: [],
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      globalState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      extensionPath: '/mock/extension/path',
      storagePath: '/mock/storage/path',
      globalStoragePath: '/mock/global/storage/path',
      logPath: '/mock/log/path',
      asAbsolutePath: vi.fn(),
      globalStorageUri: {
        fsPath: '/mock/global/storage/path',
      },
    } as any;
    
    const mockWorkspaceFolders = [{
      uri: {
        fsPath: '/mock/workspace/path',
        scheme: 'file',
        authority: '',
        path: '/mock/workspace/path',
        query: '',
        fragment: '',
        with: vi.fn(),
        toString: vi.fn(),
        toJSON: vi.fn(),
      },
      name: 'mockWorkspace',
      index: 0,
    }];
    
    vi.spyOn(workspace, 'workspaceFolders', 'get').mockReturnValue(mockWorkspaceFolders);

    activate(context);
    console.log('expect: workspace.workspaceFolders to be defined');
    expect(workspace.workspaceFolders).toBeDefined();
    console.log('expect: workspace.workspaceFolders to be defined - complete');
  });

  test('extension deactivates', () => {
    deactivate();
  });
});
