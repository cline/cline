import axios from 'axios';
import * as vscode from 'vscode';
import { config } from '../config';
import { MessageService } from './baseService';

export class DiscordService implements MessageService {
    private discordWebhookUrl: string;
    private discordChannelId: string;
    private botName: string = 'Charlotte AI';
    private chatPanel: vscode.WebviewPanel | undefined;
    private messages: {type: 'user' | 'bot', content: string}[] = [];
    private currentFiles: { name: string, content: string, size: number }[] = [];

    constructor() {
        if (!config.discordWebhookUrl || !config.discordChannelId) {
            throw new Error('Discord configuration is missing');
        }
        this.discordWebhookUrl = config.discordWebhookUrl;
        this.discordChannelId = config.discordChannelId;
    }

    public ensureChatPanel() {
        if (!this.chatPanel) {
            this.chatPanel = vscode.window.createWebviewPanel(
                'chatPanel',
                'Chat with Discord Service',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.setupDiscordListener();

            this.chatPanel.onDidDispose(() => {
                this.chatPanel = undefined;
            });

            this.chatPanel.webview.onDidReceiveMessage(async message => {
                switch (message.type) {
                    case 'sendMessage':
                        try {
                            await this.sendMessage(message.content);
                            this.currentFiles = [];
                        } catch (error) {
                            vscode.window.showErrorMessage(`Failed to send message: ${error.message}`);
                        }
                        break;
                    case 'getContext':
                        await this.handleGetContext();
                        break;
                    case 'clearContext':
                        this.clearContext();
                        break;
                    case 'removeFile':
                        this.currentFiles.splice(message.index, 1);
                        break;
                    case 'toggleService':
                        vscode.commands.executeCommand('cline.toggleService');
                        break;
                }
            });

            this.chatPanel.webview.html = this.getWebviewContent();
        }

        this.chatPanel.reveal(vscode.ViewColumn.Two);
        return this.chatPanel;
    }

    async sendMessage(message: string): Promise<string> {
        try {
            if (!message.trim()) {
                throw new Error('Message cannot be empty');
            }

            // Envoyer tous les fichiers s'il y en a
            if (this.currentFiles.length > 0) {
                for (const file of this.currentFiles) {
                    const chunkSize = 1500;
                    const chunks = [];

                    for (let i = 0; i < file.content.length; i += chunkSize) {
                        chunks.push(file.content.slice(i, i + chunkSize));
                    }

                    // Envoyer l'en-tête du fichier
                    await axios.post(this.discordWebhookUrl, {
                        content: `📎 Fichier: ${file.name}`,
                        username: "VSCode-User",
                        avatar_url: "https://code.visualstudio.com/assets/images/code-stable.png"
                    });

                    // Envoyer les morceaux
                    for (let i = 0; i < chunks.length; i++) {
                        const isLastChunk = i === chunks.length - 1;
                        const chunkHeader = chunks.length > 1 ? `Partie ${i + 1}/${chunks.length}\n` : '';
                        
                        await axios.post(this.discordWebhookUrl, {
                            content: `\`\`\`\n${chunkHeader}${chunks[i]}\n\`\`\``,
                            username: "VSCode-User",
                            avatar_url: "https://code.visualstudio.com/assets/images/code-stable.png"
                        });

                        if (!isLastChunk) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }
                }

                // Envoyer le message après tous les fichiers
                const response = await axios.post(this.discordWebhookUrl, {
                    content: `<@1336772182855909551> ${message}`,
                    username: "VSCode-User",
                    avatar_url: "https://code.visualstudio.com/assets/images/code-stable.png",
                    allowed_mentions: {
                        users: ['1336772182855909551']
                    }
                });

                // Ajouter à l'historique avec tous les fichiers
                const filesInfo = this.currentFiles
                    .map(f => `[${f.name}]`)
                    .join(', ');
                this.messages.push({ 
                    type: 'user', 
                    content: `[Fichiers joints: ${filesInfo}] ${message}`
                });

                return this.handleResponse(response);
            } else {
                // Message simple sans fichier
                const response = await axios.post(this.discordWebhookUrl, {
                    content: `<@1336772182855909551> ${message}`,
                    username: "VSCode-User",
                    avatar_url: "https://code.visualstudio.com/assets/images/code-stable.png",
                    allowed_mentions: {
                        users: ['1336772182855909551']
                    }
                });

                this.messages.push({ type: 'user', content: message });
                return this.handleResponse(response);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            throw error;
        } finally {
            if (this.chatPanel) {
                this.chatPanel.webview.html = this.getWebviewContent();
            }
            this.currentFiles = [];
        }
    }

    private handleResponse(response: any): string {
        if (response.status === 204) {
            vscode.window.setStatusBarMessage(`Message envoyé à ${this.botName}`, 3000);
            return `Message envoyé à ${this.botName}`;
        } else {
            throw new Error(`Unexpected response status: ${response.status}`);
        }
    }

    public addBotResponse(response: string) {
        console.log('Adding bot response:', response);
        this.messages.push({ type: 'bot', content: response });
        if (this.chatPanel) {
            this.chatPanel.webview.html = this.getWebviewContent();
        }
    }

    private async handleGetContext() {
        const files = await vscode.window.showOpenDialog({
            canSelectMany: true,
            openLabel: 'Sélectionner des fichiers',
            filters: undefined
        });

        if (files && files.length > 0) {
            for (const file of files) {
                try {
                    const fileContent = await vscode.workspace.fs.readFile(file);
                    const content = Buffer.from(fileContent).toString('utf8');
                    const name = file.fsPath.split(/[\\/]/).pop() || '';
                    const size = fileContent.length;

                    this.currentFiles.push({ name, content, size });

                    if (this.chatPanel) {
                        this.chatPanel.webview.postMessage({ 
                            type: 'contextSelected',
                            filename: name,
                            size: (size / 1024).toFixed(2)
                        });
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Erreur lors de la lecture du fichier ${name}`);
                    console.error(error);
                }
            }
        }
    }

    private getWebviewContent(): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {
                        margin: 0;
                        padding: 15px;
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-font-family);
                    }
                    #chat-container {
                        margin-bottom: 15px;
                        overflow-y: auto;
                        max-height: calc(100vh - 150px);
                    }
                    .message {
                        margin: 10px 0;
                        padding: 10px;
                        border-radius: 5px;
                    }
                    .user-message {
                        background-color: var(--vscode-editor-background);
                    }
                    .bot-message {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                    }
                    #files-list {
                        margin: 10px 0;
                        padding: 5px;
                        border-radius: 4px;
                    }
                    .file-item {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 5px 10px;
                        margin: 5px 0;
                        background-color: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-editor-lineHighlightBorder);
                        border-radius: 4px;
                    }
                    .file-info {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .remove-file {
                        cursor: pointer;
                        color: var(--vscode-errorForeground);
                        padding: 2px 6px;
                        border-radius: 4px;
                    }
                    .remove-file:hover {
                        background-color: var(--vscode-errorForeground);
                        color: var(--vscode-editor-background);
                    }
                    #input-container {
                        display: flex;
                        gap: 10px;
                        position: fixed;
                        bottom: 15px;
                        left: 15px;
                        right: 15px;
                        background: var(--vscode-editor-background);
                        padding: 10px;
                        border-top: 1px solid var(--vscode-editor-lineHighlightBorder);
                    }
                    #message-input {
                        flex-grow: 1;
                        padding: 8px;
                        border: 1px solid var(--vscode-input-border);
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border-radius: 4px;
                    }
                    button {
                        padding: 8px 16px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div id="chat-container">
                    ${this.messages.map(msg => `
                        <div class="message ${msg.type === 'user' ? 'user-message' : 'bot-message'}">
                            <strong>${msg.type === 'user' ? 'Vous' : this.botName}</strong>: ${msg.content}
                        </div>
                    `).join('')}
                </div>
                <div id="files-list"></div>
                <div id="input-container">
                    <button id="toggle-service" title="Changer de service">🔄 API/Discord</button>
                    <button id="context-button" title="Ajouter des fichiers">📎 Fichiers</button>
                    <input type="text" id="message-input" placeholder="Tapez votre message...">
                    <button id="send-button">Envoyer</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const filesList = document.getElementById('files-list');
                    const contextButton = document.getElementById('context-button');
                    let selectedFiles = [];

                    document.getElementById('context-button').addEventListener('click', () => {
                        vscode.postMessage({ type: 'getContext' });
                    });

                    document.getElementById('send-button').addEventListener('click', sendMessage);
                    document.getElementById('message-input').addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') sendMessage();
                    });

                    document.getElementById('toggle-service').addEventListener('click', () => {
                        vscode.postMessage({ type: 'toggleService' });
                    });

                    function sendMessage() {
                        const input = document.getElementById('message-input');
                        const message = input.value.trim();
                        if (message) {
                            vscode.postMessage({ type: 'sendMessage', content: message });
                            input.value = '';
                            selectedFiles = [];
                            filesList.innerHTML = '';
                            contextButton.textContent = '📎 Fichiers (0)';
                        }
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'contextSelected') {
                            selectedFiles.push({
                                name: message.filename,
                                size: message.size
                            });
                            updateFilesDisplay();
                        }
                    });

                    function updateFilesDisplay() {
                        filesList.innerHTML = selectedFiles.map((file, index) => \`
                            <div class="file-item">
                                <div class="file-info">
                                    <span>📎</span>
                                    <span>\${file.name} (\${file.size} KB)</span>
                                </div>
                                <span class="remove-file" onclick="removeFile(\${index})">❌</span>
                            </div>
                        \`).join('');
                        contextButton.textContent = \`📎 Fichiers (\${selectedFiles.length})\`;
                    }

                    function removeFile(index) {
                        selectedFiles.splice(index, 1);
                        updateFilesDisplay();
                        vscode.postMessage({ 
                            type: 'removeFile', 
                            index: index 
                        });
                    }
                </script>
            </body>
            </html>
        `;
    }

    private clearContext() {
        this.currentFiles = [];
    }

    private setupDiscordListener() {
        // Pas besoin d'écouter les messages ici car nous utilisons addBotResponse directement
        // La méthode peut être supprimée ou laissée vide pour une utilisation future
    }
} 