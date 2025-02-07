import axios from 'axios';
import { config } from '../config';
import * as vscode from 'vscode';

export class ElizaService {
    private discordWebhookUrl: string;
    private discordChannelId: string;
    private botName: string;
    private chatPanel: vscode.WebviewPanel | undefined;
    private messages: {type: 'user' | 'bot', content: string}[] = [];

    constructor() {
        if (!config.discordWebhookUrl || !config.discordChannelId) {
            throw new Error('Discord configuration is missing');
        }
        
        this.discordWebhookUrl = config.discordWebhookUrl;
        this.discordChannelId = config.discordChannelId;
        this.botName = config.botName;
    }

    private ensureChatPanel() {
        if (!this.chatPanel) {
            this.chatPanel = vscode.window.createWebviewPanel(
                'chatPanel',
                'Chat with Charlotte AI',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.chatPanel.onDidDispose(() => {
                this.chatPanel = undefined;
            });

            this.chatPanel.webview.onDidReceiveMessage(async message => {
                if (message.type === 'sendMessage') {
                    try {
                        await this.sendMessage(message.content);
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to send message: ${error.message}`);
                    }
                }
            });
        }

        return this.chatPanel;
    }

    async sendMessage(message: string): Promise<string> {
        try {
            if (!message.trim()) {
                throw new Error('Message cannot be empty');
            }

            const formattedMessage = `<@1336772182855909551> ${message}`;

            this.messages.push({ type: 'user', content: message });
            
            const panel = this.ensureChatPanel();
            panel.webview.html = this.getWebviewContent();

            const response = await axios.post(this.discordWebhookUrl, {
                content: formattedMessage,
                username: "VSCode-User",
                avatar_url: "https://code.visualstudio.com/assets/images/code-stable.png",
                allowed_mentions: {
                    users: ['1336772182855909551']
                }
            });

            if (response.status === 204) {
                vscode.window.setStatusBarMessage(`Message envoyé à ${this.botName}`, 3000);
                return `Message envoyé à ${this.botName}`;
            } else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            const errorDetails = error.response?.data || error.message;
            throw new Error(`Failed to send message: ${errorDetails}`);
        }
    }

    private getWebviewContent(): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        margin: 0;
                        padding: 20px;
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        background-color: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                    }
                    #chat-container {
                        flex-grow: 1;
                        overflow-y: auto;
                        margin-bottom: 20px;
                    }
                    .message {
                        margin-bottom: 10px;
                        padding: 10px;
                        border-radius: 5px;
                    }
                    .user-message {
                        background-color: var(--vscode-editor-selectionBackground);
                    }
                    .bot-message {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                    }
                    #input-container {
                        display: flex;
                        gap: 10px;
                        padding: 10px;
                        background-color: var(--vscode-editor-background);
                    }
                    #message-input {
                        flex-grow: 1;
                        padding: 8px;
                        border: 1px solid var(--vscode-input-border);
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border-radius: 4px;
                    }
                    #send-button {
                        padding: 8px 16px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    #send-button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div id="chat-container">
                    ${this.messages.map(msg => `
                        <div class="message ${msg.type === 'user' ? 'user-message' : 'bot-message'}">
                            <strong>${msg.type === 'user' ? 'Vous' : this.botName}:</strong> ${msg.content}
                        </div>
                    `).join('')}
                </div>
                <div id="input-container">
                    <input type="text" id="message-input" placeholder="Tapez votre message...">
                    <button id="send-button">Envoyer</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    document.getElementById('send-button').addEventListener('click', sendMessage);
                    document.getElementById('message-input').addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            sendMessage();
                        }
                    });

                    function sendMessage() {
                        const input = document.getElementById('message-input');
                        const message = input.value.trim();
                        if (message) {
                            vscode.postMessage({
                                type: 'sendMessage',
                                content: message
                            });
                            input.value = '';
                        }
                    }
                </script>
            </body>
            </html>
        `;
    }

    public addBotResponse(response: string) {
        this.messages.push({ type: 'bot', content: response });
        if (this.chatPanel) {
            this.chatPanel.webview.html = this.getWebviewContent();
        }
    }
}