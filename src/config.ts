import * as dotenv from 'dotenv';
import * as path from 'path';

// Charger le .env depuis le dossier racine de l'extension
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
    elizaUrl: 'http://localhost:3000',
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    discordChannelId: process.env.DISCORD_CHANNEL_ID,
    discordApiToken: process.env.DISCORD_API_TOKEN,
    botName: 'Charlotte AI'
}; 