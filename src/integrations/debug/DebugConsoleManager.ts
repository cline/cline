import * as vscode from "vscode"

interface DebugOutput {
    sessionId: string;
    sessionName: string;
    lines: string[];
}

export class DebugConsoleManager {
    private debugOutputs: Map<string, DebugOutput> = new Map()
    private disposables: vscode.Disposable[] = []

    constructor() {
        // Listen for new debug sessions
        this.disposables.push(
            vscode.debug.onDidStartDebugSession(session => {
                this.debugOutputs.set(session.id, {
                    sessionId: session.id,
                    sessionName: session.name || session.type,
                    lines: []
                });
            })
        );

        // Listen to debug console output
        this.disposables.push(
            vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
                // Skip internal debug adapter operations
                if (event.body?.output?.includes('js-debug/dap/operation') || 
                    event.body?.output?.includes('js-debug/cdp/operation')) {
                    return;
                }

                if (event.event === "output" && event.body?.output) {
                    const sessionOutput = this.debugOutputs.get(event.session.id);
                    if (sessionOutput) {
                        // Split output into lines and add each non-empty line
                        const newLines = event.body.output.split('\n')
                            .map((line: string) => line.trim())
                            .filter((line: string) => line.length > 0)
                            .filter((line: string) => !line.includes('js-debug/')); // Additional filter for any js-debug messages
                        
                        if (newLines.length > 0) {
                            sessionOutput.lines.push(...newLines);
                            
                            // Keep only last 10 lines
                            if (sessionOutput.lines.length > 10) {
                                sessionOutput.lines = sessionOutput.lines.slice(-10);
                            }
                        }
                    }
                }
            })
        );

        // Also listen to debug console directly
        this.disposables.push(
            vscode.debug.registerDebugAdapterTrackerFactory("*", {
                createDebugAdapterTracker: (session: vscode.DebugSession) => ({
                    onDidSendMessage: message => {
                        if (message.type === 'event' && message.event === 'output' && message.body?.output) {
                            // Skip internal debug adapter operations
                            if (message.body.output.includes('js-debug/dap/operation') || 
                                message.body.output.includes('js-debug/cdp/operation')) {
                                return;
                            }

                            const sessionOutput = this.debugOutputs.get(session.id);
                            if (sessionOutput) {
                                const lines = message.body.output.split('\n')
                                    .map((line: string) => line.trim())
                                    .filter((line: string) => line.length > 0)
                                    .filter((line: string) => !line.includes('js-debug/')); // Additional filter for any js-debug messages
                                
                                if (lines.length > 0) {
                                    sessionOutput.lines.push(...lines);
                                    
                                    // Keep only last 10 lines
                                    if (sessionOutput.lines.length > 10) {
                                        sessionOutput.lines = sessionOutput.lines.slice(-10);
                                    }
                                }
                            }
                        }
                    }
                })
            })
        );

        // Clean up when debug sessions end
        this.disposables.push(
            vscode.debug.onDidTerminateDebugSession(session => {
                this.debugOutputs.delete(session.id);
            })
        );

        // Add any already active debug sessions
        if (vscode.debug.activeDebugSession) {
            this.debugOutputs.set(vscode.debug.activeDebugSession.id, {
                sessionId: vscode.debug.activeDebugSession.id,
                sessionName: vscode.debug.activeDebugSession.name || vscode.debug.activeDebugSession.type,
                lines: []
            });
        }
    }

    getLatestOutput(): string {
        let output = "";
        for (const [_, sessionOutput] of this.debugOutputs) {
            if (sessionOutput.lines.length > 0) {
                output += `[${sessionOutput.sessionName}]\n`;
                output += sessionOutput.lines.join('\n');
                output += "\n\n";
            }
        }
        return output.trim();
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.debugOutputs.clear();
    }
}
