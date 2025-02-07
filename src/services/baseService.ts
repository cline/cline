export interface MessageService {
    sendMessage(message: string, files?: Array<{name: string, content: string}>): Promise<string>;
    addBotResponse(response: string): void;
    ensureChatPanel(): void;
} 