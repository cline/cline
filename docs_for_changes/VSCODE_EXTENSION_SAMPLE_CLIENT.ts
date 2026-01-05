// /**
//  * Sample TypeScript Client for Quantrel Backend Integration
//  *
//  * This shows how to implement authentication and API calls in your Cline fork.
//  * Copy/adapt these patterns into your VS Code extension.
//  */

// import * as vscode from 'vscode';

// // Configuration
// const API_BASE_URL = 'http://localhost:8080/api';

// // ============================================================================
// // 1. AUTHENTICATION SERVICE
// // ============================================================================

// export class QuantrelAuthService {
//     private context: vscode.ExtensionContext;
//     private token: string | undefined;

//     constructor(context: vscode.ExtensionContext) {
//         this.context = context;
//     }

//     /**
//      * Initialize - load token from secure storage
//      */
//     async initialize(): Promise<boolean> {
//         this.token = await this.context.secrets.get('quantrel.jwt.token');
//         return this.token !== undefined;
//     }

//     /**
//      * Login with email/password
//      */
//     async login(email: string, password: string): Promise<boolean> {
//         try {
//             const response = await fetch(`${API_BASE_URL}/auth/login`, {
//                 method: 'POST',
//                 headers: {
//                     'Content-Type': 'application/json',
//                 },
//                 body: JSON.stringify({ email, password }),
//             });

//             if (!response.ok) {
//                 const error = await response.json();
//                 throw new Error(error.message || 'Login failed');
//             }

//             const data = await response.json();
//             this.token = data.token;

//             // Store token securely
//             await this.context.secrets.store('quantrel.jwt.token', this.token);

//             vscode.window.showInformationMessage('Successfully logged in to Quantrel!');
//             return true;
//         } catch (error) {
//             vscode.window.showErrorMessage(`Login failed: ${error.message}`);
//             return false;
//         }
//     }

//     /**
//      * Register new user
//      */
//     async register(email: string, password: string, name: string): Promise<boolean> {
//         try {
//             const response = await fetch(`${API_BASE_URL}/auth/register`, {
//                 method: 'POST',
//                 headers: {
//                     'Content-Type': 'application/json',
//                 },
//                 body: JSON.stringify({ email, password, name }),
//             });

//             if (!response.ok) {
//                 const error = await response.json();
//                 throw new Error(error.message || 'Registration failed');
//             }

//             // Auto-login after registration
//             return await this.login(email, password);
//         } catch (error) {
//             vscode.window.showErrorMessage(`Registration failed: ${error.message}`);
//             return false;
//         }
//     }

//     /**
//      * Logout - clear stored token
//      */
//     async logout(): Promise<void> {
//         this.token = undefined;
//         await this.context.secrets.delete('quantrel.jwt.token');
//         vscode.window.showInformationMessage('Logged out successfully');
//     }

//     /**
//      * Check if user is authenticated
//      */
//     isAuthenticated(): boolean {
//         return this.token !== undefined;
//     }

//     /**
//      * Get current token
//      */
//     getToken(): string | undefined {
//         return this.token;
//     }

//     /**
//      * Make authenticated request
//      */
//     async request<T>(
//         endpoint: string,
//         options: RequestInit = {}
//     ): Promise<T> {
//         if (!this.token) {
//             throw new Error('Not authenticated. Please login first.');
//         }

//         const response = await fetch(`${API_BASE_URL}${endpoint}`, {
//             ...options,
//             headers: {
//                 ...options.headers,
//                 'Authorization': `Bearer ${this.token}`,
//                 'Content-Type': 'application/json',
//             },
//         });

//         if (response.status === 401) {
//             // Token expired or invalid
//             await this.logout();
//             throw new Error('Session expired. Please login again.');
//         }

//         if (!response.ok) {
//             const error = await response.json();
//             throw new Error(error.message || `Request failed: ${response.status}`);
//         }

//         return await response.json();
//     }
// }

// // ============================================================================
// // 2. QUANTREL API CLIENT
// // ============================================================================

// export interface AIModel {
//     id: number;
//     modelId: string;
//     name: string;
//     publisher: string;
//     briefDescription: string;
//     contextWindow: number;
//     inputPrice: number;
//     outputPrice: number;
//     inputTypes: string[];
//     outputTypes: string[];
//     tags: string[];
//     isActive: boolean;
// }

// export interface ChatSession {
//     id: number;
//     title: string;
//     agentId?: number;
//     status: string;
//     createdAt: string;
//     lastMessageAt?: string;
// }

// export interface ChatMessage {
//     id: number;
//     chatSessionId: number;
//     role: 'user' | 'assistant';
//     content: string;
//     tokensUsed?: number;
//     inputTokens?: number;
//     outputTokens?: number;
//     createdAt: string;
// }

// export class QuantrelClient {
//     private authService: QuantrelAuthService;

//     constructor(authService: QuantrelAuthService) {
//         this.authService = authService;
//     }

//     // ========================================================================
//     // Model Management
//     // ========================================================================

//     /**
//      * Get all available models from marketplace
//      */
//     async getModels(params?: {
//         category?: string;
//         q?: string;
//     }): Promise<AIModel[]> {
//         const queryParams = new URLSearchParams();
//         if (params?.category) queryParams.set('category', params.category);
//         if (params?.q) queryParams.set('q', params.q);

//         const url = `/agents${queryParams.toString() ? '?' + queryParams : ''}`;
//         return await this.authService.request<AIModel[]>(url);
//     }

//     /**
//      * Get specific model details
//      */
//     async getModel(id: number): Promise<AIModel> {
//         return await this.authService.request<AIModel>(`/agents/${id}`);
//     }

//     // ========================================================================
//     // Chat Management
//     // ========================================================================

//     /**
//      * Create new chat session
//      */
//     async createChatSession(title: string, agentId?: number): Promise<ChatSession> {
//         return await this.authService.request<ChatSession>('/chats', {
//             method: 'POST',
//             body: JSON.stringify({ title, agentId }),
//         });
//     }

//     /**
//      * Get all chat sessions for user
//      */
//     async getChatSessions(): Promise<ChatSession[]> {
//         return await this.authService.request<ChatSession[]>('/chats');
//     }

//     /**
//      * Get messages in a chat session
//      */
//     async getChatMessages(chatId: number): Promise<ChatMessage[]> {
//         return await this.authService.request<ChatMessage[]>(`/chats/${chatId}/messages`);
//     }

//     /**
//      * Send message (non-streaming)
//      */
//     async sendMessage(chatId: number, content: string): Promise<ChatMessage> {
//         return await this.authService.request<ChatMessage>(
//             `/chats/${chatId}/messages`,
//             {
//                 method: 'POST',
//                 body: JSON.stringify({
//                     content,
//                     sender: 'USER',
//                     role: 'user',
//                 }),
//             }
//         );
//     }

//     /**
//      * Send message with streaming (SSE)
//      * Returns an async generator that yields text chunks
//      */
//     async *streamMessage(
//         chatId: number,
//         content: string
//     ): AsyncGenerator<{
//         delta: string;
//         done: boolean;
//         inputTokens?: number;
//         outputTokens?: number;
//         messageId?: number;
//     }> {
//         const token = this.authService.getToken();
//         if (!token) {
//             throw new Error('Not authenticated');
//         }

//         const response = await fetch(`${API_BASE_URL}/chats/${chatId}/messages/stream`, {
//             method: 'POST',
//             headers: {
//                 'Authorization': `Bearer ${token}`,
//                 'Content-Type': 'application/json',
//                 'Accept': 'text/event-stream',
//             },
//             body: JSON.stringify({
//                 content,
//                 sender: 'USER',
//                 role: 'user',
//             }),
//         });

//         if (!response.ok) {
//             throw new Error(`Stream failed: ${response.status}`);
//         }

//         const reader = response.body!.getReader();
//         const decoder = new TextDecoder();
//         let buffer = '';

//         try {
//             while (true) {
//                 const { done, value } = await reader.read();
//                 if (done) break;

//                 buffer += decoder.decode(value, { stream: true });
//                 const lines = buffer.split('\n');
//                 buffer = lines.pop() || '';

//                 for (const line of lines) {
//                     if (line.startsWith('data: ')) {
//                         const data = line.slice(6);
//                         if (data === '[DONE]') {
//                             return;
//                         }

//                         try {
//                             const parsed = JSON.parse(data);
//                             yield parsed;

//                             if (parsed.done) {
//                                 return;
//                             }
//                         } catch (e) {
//                             console.error('Failed to parse SSE data:', data);
//                         }
//                     }
//                 }
//             }
//         } finally {
//             reader.releaseLock();
//         }
//     }

//     /**
//      * Cancel active stream
//      */
//     async cancelStream(chatId: number): Promise<void> {
//         await this.authService.request(`/chats/${chatId}/stream/cancel`, {
//             method: 'POST',
//         });
//     }

//     // ========================================================================
//     // Credits Management
//     // ========================================================================

//     /**
//      * Get user's credit balance
//      */
//     async getCredits(): Promise<{
//         balance: number;
//         currency: string;
//     }> {
//         return await this.authService.request('/credits/me');
//     }
// }

// // ============================================================================
// // 3. VS CODE INTEGRATION EXAMPLE
// // ============================================================================

// /**
//  * Example of how to use this in your extension's activate() function
//  */
// export async function activateExample(context: vscode.ExtensionContext) {
//     // Initialize auth service
//     const authService = new QuantrelAuthService(context);
//     await authService.initialize();

//     const client = new QuantrelClient(authService);

//     // Register login command
//     context.subscriptions.push(
//         vscode.commands.registerCommand('quantrel.login', async () => {
//             const email = await vscode.window.showInputBox({
//                 prompt: 'Enter your email',
//                 placeHolder: 'user@example.com',
//             });

//             if (!email) return;

//             const password = await vscode.window.showInputBox({
//                 prompt: 'Enter your password',
//                 password: true,
//             });

//             if (!password) return;

//             await authService.login(email, password);
//         })
//     );

//     // Register logout command
//     context.subscriptions.push(
//         vscode.commands.registerCommand('quantrel.logout', async () => {
//             await authService.logout();
//         })
//     );

//     // Register model selector command
//     context.subscriptions.push(
//         vscode.commands.registerCommand('quantrel.selectModel', async () => {
//             if (!authService.isAuthenticated()) {
//                 vscode.window.showWarningMessage('Please login first');
//                 return;
//             }

//             try {
//                 const models = await client.getModels();

//                 const selected = await vscode.window.showQuickPick(
//                     models.map(m => ({
//                         label: m.name,
//                         description: m.publisher,
//                         detail: m.briefDescription,
//                         modelId: m.modelId,
//                     })),
//                     {
//                         placeHolder: 'Select an AI model',
//                     }
//                 );

//                 if (selected) {
//                     // Store selected model
//                     await context.globalState.update('quantrel.selectedModel', selected.modelId);
//                     vscode.window.showInformationMessage(`Selected: ${selected.label}`);
//                 }
//             } catch (error) {
//                 vscode.window.showErrorMessage(`Failed to load models: ${error.message}`);
//             }
//         })
//     );

//     // Register chat command with streaming
//     context.subscriptions.push(
//         vscode.commands.registerCommand('quantrel.chat', async () => {
//             if (!authService.isAuthenticated()) {
//                 vscode.window.showWarningMessage('Please login first');
//                 return;
//             }

//             const message = await vscode.window.showInputBox({
//                 prompt: 'Enter your message',
//                 placeHolder: 'Write a Python function to reverse a string',
//             });

//             if (!message) return;

//             try {
//                 // Create or get chat session
//                 const sessions = await client.getChatSessions();
//                 let chatId: number;

//                 if (sessions.length === 0) {
//                     const session = await client.createChatSession('VS Code Chat');
//                     chatId = session.id;
//                 } else {
//                     chatId = sessions[0].id;
//                 }

//                 // Stream response
//                 vscode.window.withProgress(
//                     {
//                         location: vscode.ProgressLocation.Notification,
//                         title: 'AI is thinking...',
//                         cancellable: true,
//                     },
//                     async (progress, token) => {
//                         let fullResponse = '';

//                         token.onCancellationRequested(() => {
//                             client.cancelStream(chatId);
//                         });

//                         try {
//                             for await (const chunk of client.streamMessage(chatId, message)) {
//                                 if (chunk.delta) {
//                                     fullResponse += chunk.delta;
//                                     progress.report({ message: chunk.delta });
//                                 }

//                                 if (chunk.done) {
//                                     vscode.window.showInformationMessage(
//                                         `Tokens used: ${chunk.inputTokens! + chunk.outputTokens!}`
//                                     );
//                                 }
//                             }

//                             // Show full response in new document
//                             const doc = await vscode.workspace.openTextDocument({
//                                 content: fullResponse,
//                                 language: 'markdown',
//                             });
//                             await vscode.window.showTextDocument(doc);
//                         } catch (error) {
//                             vscode.window.showErrorMessage(`Chat failed: ${error.message}`);
//                         }
//                     }
//                 );
//             } catch (error) {
//                 vscode.window.showErrorMessage(`Failed to send message: ${error.message}`);
//             }
//         })
//     );

//     // Check auth status on startup
//     if (authService.isAuthenticated()) {
//         vscode.window.showInformationMessage('Welcome back to Quantrel!');
//     }
// }
