import { DiffViewProvider } from '../DiffViewProvider';
import * as vscode from 'vscode';

// Mock vscode
jest.mock('vscode', () => ({
	workspace: {
		applyEdit: jest.fn(),
	},
	window: {
		createTextEditorDecorationType: jest.fn(),
	},
	WorkspaceEdit: jest.fn().mockImplementation(() => ({
		replace: jest.fn(),
		delete: jest.fn(),
	})),
	Range: jest.fn(),
	Position: jest.fn(),
	Selection: jest.fn(),
	TextEditorRevealType: {
		InCenter: 2,
	},
}));

// Mock DecorationController
jest.mock('../DecorationController', () => ({
	DecorationController: jest.fn().mockImplementation(() => ({
		setActiveLine: jest.fn(),
		updateOverlayAfterLine: jest.fn(),
		clear: jest.fn(),
	})),
}));

describe('DiffViewProvider', () => {
	let diffViewProvider: DiffViewProvider;
	const mockCwd = '/mock/cwd';
	let mockWorkspaceEdit: { replace: jest.Mock; delete: jest.Mock };

	beforeEach(() => {
		jest.clearAllMocks();
		mockWorkspaceEdit = {
			replace: jest.fn(),
			delete: jest.fn(),
		};
		(vscode.WorkspaceEdit as jest.Mock).mockImplementation(() => mockWorkspaceEdit);

		diffViewProvider = new DiffViewProvider(mockCwd);
		// Mock the necessary properties and methods
		(diffViewProvider as any).relPath = 'test.txt';
		(diffViewProvider as any).activeDiffEditor = {
			document: {
				uri: { fsPath: `${mockCwd}/test.txt` },
				getText: jest.fn(),
				lineCount: 10,
			},
			selection: {
				active: { line: 0, character: 0 },
				anchor: { line: 0, character: 0 },
			},
			edit: jest.fn().mockResolvedValue(true),
			revealRange: jest.fn(),
		};
		(diffViewProvider as any).activeLineController = { setActiveLine: jest.fn(), clear: jest.fn() };
		(diffViewProvider as any).fadedOverlayController = { updateOverlayAfterLine: jest.fn(), clear: jest.fn() };
	});

	describe('update method', () => {
		it('should preserve empty last line when original content has one', async () => {
			(diffViewProvider as any).originalContent = 'Original content\n';
			await diffViewProvider.update('New content', true);

			expect(mockWorkspaceEdit.replace).toHaveBeenCalledWith(
				expect.anything(),
				expect.anything(),
				'New content\n'
			);
		});

		it('should not add extra newline when accumulated content already ends with one', async () => {
			(diffViewProvider as any).originalContent = 'Original content\n';
			await diffViewProvider.update('New content\n', true);

			expect(mockWorkspaceEdit.replace).toHaveBeenCalledWith(
				expect.anything(),
				expect.anything(),
				'New content\n'
			);
		});

		it('should not add newline when original content does not end with one', async () => {
			(diffViewProvider as any).originalContent = 'Original content';
			await diffViewProvider.update('New content', true);

			expect(mockWorkspaceEdit.replace).toHaveBeenCalledWith(
				expect.anything(),
				expect.anything(),
				'New content'
			);
		});
	});
});