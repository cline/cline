import axios from 'axios';
import { config } from '../config';
import * as vscode from 'vscode';

export class ElizaService {
    private discordWebhookUrl: string;
    private discordChannelId: string;
    private botName: string;
    private chatPanel: vscode.WebviewPanel | undefined;
    private messages: {type: 'user' | 'bot', content: string}[] = [];
    private currentFiles: { name: string, content: string, size: number }[] = [];

    constructor() {
        if (!config.discordWebhookUrl || !config.discordChannelId) {
            throw new Error('Discord configuration is missing');
        }
        
        this.discordWebhookUrl = config.discordWebhookUrl;
        this.discordChannelId = config.discordChannelId;
        this.botName = config.botName;
    }

    public ensureChatPanel() {
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

    private getWebviewContent(): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
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
                    #context-button {
                        padding: 8px 16px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-right: 10px;
                    }
                    #context-button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    .context-active {
                        background-color: var(--vscode-statusBarItem-warningBackground) !important;
                    }
                    .file-info {
                        font-size: 0.8em;
                        color: var(--vscode-descriptionForeground);
                        margin-top: 5px;
                    }
                    #context-container {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        margin-bottom: 10px;
                    }
                    #clear-context {
                        padding: 4px 8px;
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 0.8em;
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
                    <button id="context-button" title="Ajouter des fichiers">📎 Fichiers (${this.currentFiles.length})</button>
                    <input type="text" id="message-input" placeholder="Tapez votre message...">
                    <button id="send-button">Envoyer</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const filesList = document.getElementById('files-list');
                    const contextButton = document.getElementById('context-button');

                    document.getElementById('context-button').addEventListener('click', () => {
                        vscode.postMessage({ type: 'getContext' });
                    });

                    document.getElementById('send-button').addEventListener('click', sendMessage);
                    document.getElementById('message-input').addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') sendMessage();
                    });

                    function sendMessage() {
                        const input = document.getElementById('message-input');
                        const message = input.value.trim();
                        if (message) {
                            vscode.postMessage({ type: 'sendMessage', content: message });
                            input.value = '';
                            filesList.innerHTML = '';
                            contextButton.title = "Ajouter des fichiers";
                            contextButton.textContent = "📎 Fichiers (0)";
                        }
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'contextSelected') {
                            const fileItem = document.createElement('div');
                            fileItem.className = 'file-item';
                            fileItem.innerHTML = \`
                                <div class="file-info">
                                    <span>📎</span>
                                    <span>\${message.filename} (\${message.size} KB)</span>
                                </div>
                                <span class="remove-file" onclick="removeFile('\${message.filename}')">❌</span>
                            \`;
                            filesList.appendChild(fileItem);
                            
                            // Mettre à jour le compteur de fichiers
                            const currentCount = filesList.children.length;
                            contextButton.textContent = \`📎 Fichiers (\${currentCount})\`;
                        }
                    });

                    function removeFile(filename) {
                        const items = filesList.getElementsByClassName('file-item');
                        for (let i = 0; i < items.length; i++) {
                            if (items[i].textContent.includes(filename)) {
                                items[i].remove();
                                vscode.postMessage({ type: 'removeFile', index: i });
                                break;
                            }
                        }
                        // Mettre à jour le compteur
                        const currentCount = filesList.children.length;
                        contextButton.textContent = \`📎 Fichiers (\${currentCount})\`;
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

    private clearContext() {
        this.currentFiles = [];
    }
}