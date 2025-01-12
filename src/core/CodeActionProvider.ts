import * as vscode from 'vscode';
import * as path from 'path';

export const ACTION_NAMES = {
    EXPLAIN: 'Roo Cline: Explain Code',
    FIX: 'Roo Cline: Fix Code',
    IMPROVE: 'Roo Cline: Improve Code'
} as const;

const COMMAND_IDS = {
    EXPLAIN: 'roo-cline.explainCode',
    FIX: 'roo-cline.fixCode',
    IMPROVE: 'roo-cline.improveCode'
} as const;

interface DiagnosticData {
    message: string;
    severity: vscode.DiagnosticSeverity;
    code?: string | number | { value: string | number; target: vscode.Uri };
    source?: string;
    range: vscode.Range;
}

interface EffectiveRange {
    range: vscode.Range;
    text: string;
}

export class CodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
        vscode.CodeActionKind.RefactorRewrite,
    ];

    // Cache file paths for performance
    private readonly filePathCache = new WeakMap<vscode.TextDocument, string>();

    private getEffectiveRange(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection
    ): EffectiveRange | null {
        try {
            const selectedText = document.getText(range);
            if (selectedText) {
                return { range, text: selectedText };
            }

            const currentLine = document.lineAt(range.start.line);
            if (!currentLine.text.trim()) {
                return null;
            }

            // Optimize range creation by checking bounds first
            const startLine = Math.max(0, currentLine.lineNumber - 1);
            const endLine = Math.min(document.lineCount - 1, currentLine.lineNumber + 1);
            
            // Only create new positions if needed
            const effectiveRange = new vscode.Range(
                startLine === currentLine.lineNumber ? range.start : new vscode.Position(startLine, 0),
                endLine === currentLine.lineNumber ? range.end : new vscode.Position(endLine, document.lineAt(endLine).text.length)
            );

            return {
                range: effectiveRange,
                text: document.getText(effectiveRange)
            };
        } catch (error) {
            console.error('Error getting effective range:', error);
            return null;
        }
    }

    private getFilePath(document: vscode.TextDocument): string {
        // Check cache first
        let filePath = this.filePathCache.get(document);
        if (filePath) {
            return filePath;
        }

        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (!workspaceFolder) {
                filePath = document.uri.fsPath;
            } else {
                const relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath);
                filePath = (!relativePath || relativePath.startsWith('..')) ? document.uri.fsPath : relativePath;
            }

            // Cache the result
            this.filePathCache.set(document, filePath);
            return filePath;
        } catch (error) {
            console.error('Error getting file path:', error);
            return document.uri.fsPath;
        }
    }

    private createDiagnosticData(diagnostic: vscode.Diagnostic): DiagnosticData {
        return {
            message: diagnostic.message,
            severity: diagnostic.severity,
            code: diagnostic.code,
            source: diagnostic.source,
            range: diagnostic.range // Reuse the range object
        };
    }

    private createAction(
        title: string,
        kind: vscode.CodeActionKind,
        command: string,
        args: any[]
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(title, kind);
        action.command = { command, title, arguments: args };
        return action;
    }

    private hasIntersectingRange(range1: vscode.Range, range2: vscode.Range): boolean {
        // Optimize range intersection check
        return !(
            range2.end.line < range1.start.line ||
            range2.start.line > range1.end.line ||
            (range2.end.line === range1.start.line && range2.end.character < range1.start.character) ||
            (range2.start.line === range1.end.line && range2.start.character > range1.end.character)
        );
    }

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        try {
            const effectiveRange = this.getEffectiveRange(document, range);
            if (!effectiveRange) {
                return [];
            }

            const filePath = this.getFilePath(document);
            const actions: vscode.CodeAction[] = [];

            // Create actions using helper method
            actions.push(this.createAction(
                ACTION_NAMES.EXPLAIN,
                vscode.CodeActionKind.QuickFix,
                COMMAND_IDS.EXPLAIN,
                [filePath, effectiveRange.text]
            ));

            // Only process diagnostics if they exist
            if (context.diagnostics.length > 0) {
                const relevantDiagnostics = context.diagnostics.filter(d =>
                    this.hasIntersectingRange(effectiveRange.range, d.range)
                );

                if (relevantDiagnostics.length > 0) {
                    const diagnosticMessages = relevantDiagnostics.map(this.createDiagnosticData);
                    actions.push(this.createAction(
                        ACTION_NAMES.FIX,
                        vscode.CodeActionKind.QuickFix,
                        COMMAND_IDS.FIX,
                        [filePath, effectiveRange.text, diagnosticMessages]
                    ));
                }
            }

            actions.push(this.createAction(
                ACTION_NAMES.IMPROVE,
                vscode.CodeActionKind.RefactorRewrite,
                COMMAND_IDS.IMPROVE,
                [filePath, effectiveRange.text]
            ));

            return actions;
        } catch (error) {
            console.error('Error providing code actions:', error);
            return [];
        }
    }
}