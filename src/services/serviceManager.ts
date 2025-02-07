import { MessageService } from './baseService';
import { DiscordService } from './discordService';
import { ApiService } from './apiService';
import { config } from '../config';

export class ServiceManager {
    private discordService: DiscordService;
    private apiService: ApiService;
    private activeService: MessageService;

    constructor() {
        this.discordService = new DiscordService();
        this.apiService = new ApiService(config.apiUrl);
        // Initialiser avec le service par défaut
        this.activeService = config.defaultService === 'api' ? this.apiService : this.discordService;
    }

    public switchService(type: 'discord' | 'api') {
        this.activeService = type === 'discord' ? this.discordService : this.apiService;
    }

    public getCurrentService(): MessageService {
        return this.activeService;
    }

    public getService(): MessageService {
        return this.activeService;
    }

    public async sendMessage(message: string, files?: Array<{name: string, content: string}>) {
        return this.getService().sendMessage(message, files);
    }
} 