import { afterEach, describe, expect, test, vi } from 'vitest';
import { Uri, window, workspace, type WorkspaceFolder } from 'vscode';

vi.mock('vscode');

const testFileUri = Uri.file(__filename);
const rootUri = Uri.file(__dirname);
const workspaceFolder1: WorkspaceFolder = {
  uri: Uri.joinPath(rootUri, 'Folder1'),
  name: 'Folder1',
  index: 0,
};

const workspaceFolder2: WorkspaceFolder = {
  uri: Uri.joinPath(rootUri, 'Folder2'),
  name: 'Folder2',
  index: 1,
};

describe('vscode.workspace', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  test('getWorkspaceFolder', () => {
    const uri = Uri.joinPath(workspaceFolder1.uri, 'code.test.ts');
    const uri2 = Uri.joinPath(workspaceFolder2.uri, 'test.txt');

    const spy = vi.spyOn(workspace, 'workspaceFolders', 'get');
    spy.mockReturnValue([workspaceFolder1, workspaceFolder2]);

    expect(workspace.workspaceFolders).toEqual([workspaceFolder1, workspaceFolder2]);
    expect(workspace.getWorkspaceFolder(uri)).toEqual(workspaceFolder1);
    expect(workspace.getWorkspaceFolder(uri2)).toEqual(workspaceFolder2);
  });

  test('openTextDocument', async () => {
    const uri = testFileUri;
    const doc = await workspace.openTextDocument(uri);
    expect(doc.uri).toEqual(uri);
    expect(doc.getText()).toContain("vi.mock('vscode');");
  });
});

describe('vscode.window', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  test('showTextDocument', async () => {
    const uri = testFileUri;
    const doc = await workspace.openTextDocument(uri);
    const editor = await window.showTextDocument(doc);
    expect(editor.document).toBe(doc);
  });
});
