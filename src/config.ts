import * as dotenv from 'dotenv';
import * as path from 'path';

// Charger le .env depuis le dossier racine de l'extension
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
    // Config Discord existante
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    discordChannelId: process.env.DISCORD_CHANNEL_ID,
    discordApiToken: process.env.DISCORD_API_TOKEN,
    botName: 'Charlotte AI',
    
    // Nouvelle config API
    apiUrl: process.env.ELIZA_API_URL || 'http://localhost:3000/api',
    apiKey: process.env.ELIZA_API_KEY,
    
    // Service par défaut
    defaultService: process.env.DEFAULT_SERVICE || 'discord'
}; 