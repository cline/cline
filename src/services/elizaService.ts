import axios from 'axios';
import { config } from '../config';
import * as vscode from 'vscode';

export class ElizaService {
    private discordWebhookUrl: string;
    private discordChannelId: string;
    private botName: string;

    constructor() {
        this.discordWebhookUrl = config.discordWebhookUrl;
        this.discordChannelId = config.discordChannelId;
        this.botName = config.botName;
        
        // Log la configuration au démarrage
        console.log('ElizaService initialized with config:', {
            channelId: this.discordChannelId,
            botName: this.botName
        });
    }

    async sendMessage(message: string): Promise<string> {
        try {
            // Ajouter la mention de Charlotte AI au début du message
            const formattedMessage = `@Charlotte AI ${message}`;
            console.log('Sending message to Discord:', formattedMessage);
            
            const response = await axios.post(this.discordWebhookUrl, {
                content: formattedMessage,
                username: "VSCode-User",
                avatar_url: "https://code.visualstudio.com/assets/images/code-stable.png",
                // Activer les mentions dans le message
                allowed_mentions: {
                    parse: ["users", "roles"]
                }
            });

            if (response.status === 204) { // Discord returns 204 on success
                vscode.window.setStatusBarMessage(`Message envoyé à ${this.botName}`, 3000);
                return `Message envoyé à ${this.botName}. Vérifiez Discord pour la réponse.`;
            } else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            const errorMessage = error.response ? 
                `${error.response.status}: ${error.response.statusText}` :
                error.message;
            throw new Error(`Failed to send message: ${errorMessage}`);
        }
    }
} 