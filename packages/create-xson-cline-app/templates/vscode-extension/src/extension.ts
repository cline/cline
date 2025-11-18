import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('XSON Cline extension is now active!');

  const disposable = vscode.commands.registerCommand('xson-cline.helloWorld', () => {
    vscode.window.showInformationMessage('Hello from XSON Cline! 👋');
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
