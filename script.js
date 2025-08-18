import { openaiConfig } from "https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1.2";
import { asyncLLM } from "https://cdn.jsdelivr.net/npm/asyncllm@2/+esm";
import { marked } from "https://cdn.jsdelivr.net/npm/marked@9/+esm";

class RoutingAssistant {
    constructor() {
        this.prompts = '';
        this.fileList = '';
        this.llmConfig = null;
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        document.getElementById('config-llm-btn').addEventListener('click', () => this.configureLLM());

        // Chat handlers
        document.getElementById('send-btn').addEventListener('click', () => this.handleSendMessage());
        document.getElementById('user-question').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSendMessage();
        });

        // Load files and check LLM config on load
        this.loadFiles();
        this.checkExistingConfig();
    }

    async loadFiles() {
        try {
            this.updateFilesStatus('Loading prompts.txt...');
            const promptsResponse = await fetch('prompts.txt');
            if (!promptsResponse.ok) throw new Error(`Failed to load prompts.txt: ${promptsResponse.status}`);
            this.prompts = await promptsResponse.text();
            this.logDebug(`Prompts loaded: ${this.prompts.substring(0, 100)}...`);

            this.updateFilesStatus('Loading file-list.txt...');
            const fileListResponse = await fetch('file-list.txt');
            if (!fileListResponse.ok) throw new Error(`Failed to load file-list.txt: ${fileListResponse.status}`);
            this.fileList = await fileListResponse.text();
            this.logDebug(`File list loaded: ${this.fileList.substring(0, 100)}...`);

            this.updateFilesStatus('✓ Files loaded successfully');
            this.updateUIState();
        } catch (error) {
            this.updateFilesStatus(`Error: ${error.message}`);
            this.addMessage('system', `Failed to load files: ${error.message}`);
        }
    }

    async configureLLM() {
        try {
            this.llmConfig = await openaiConfig({
                defaultBaseUrls: [
                    "https://api.openai.com/v1",
                    "https://openrouter.ai/api/v1", 
                    "https://api.anthropic.com/v1",
                    "http://localhost:11434/v1",
                    "https://api.groq.com/openai/v1"
                ],
                title: "Configure LLM Provider",
                baseUrlLabel: "API Base URL (any OpenAI-compatible endpoint)",
                help: '<div class="alert alert-info">Enter any OpenAI-compatible API endpoint. Examples:<br>• OpenAI: <code>https://api.openai.com/v1</code><br>• OpenRouter: <code>https://openrouter.ai/api/v1</code><br>• Local Ollama: <code>http://localhost:11434/v1</code><br>• Your proxy: <code>https://your-proxy.com/v1</code><br><br>Get API keys: <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI</a> | <a href="https://openrouter.ai/keys" target="_blank">OpenRouter</a></div>',
                show: true
            });
            
            this.updateConfigStatus();
            this.updateUIState();
            this.logDebug('LLM configured:', { baseUrl: this.llmConfig.baseUrl, models: this.llmConfig.models.length });
        } catch (error) {
            this.addMessage('system', `Failed to configure LLM: ${error.message}`);
        }
    }

    async checkExistingConfig() {
        try {
            // Try to get existing config without showing modal
            this.llmConfig = await openaiConfig({ show: false });
            this.updateConfigStatus();
            this.updateUIState();
            this.logDebug('Existing LLM config loaded');
        } catch (error) {
            // No existing config, that's fine
            this.logDebug('No existing LLM config found');
        }
    }

    updateConfigStatus() {
        const statusEl = document.getElementById('config-status');
        const btnEl = document.getElementById('config-llm-btn');
        
        if (this.llmConfig) {
            const url = new URL(this.llmConfig.baseUrl);
            const provider = url.hostname.includes('openai') ? 'OpenAI' : 
                           url.hostname.includes('openrouter') ? 'OpenRouter' : 
                           url.hostname.includes('localhost') ? 'Local' :
                           url.hostname.includes('groq') ? 'Groq' :
                           url.hostname;
            statusEl.textContent = `✓ Configured: ${provider} (${this.llmConfig.models?.length || 0} models)`;
            btnEl.textContent = 'Reconfigure LLM';
            btnEl.className = 'btn btn-success w-100';
        } else {
            statusEl.textContent = 'Click to setup your LLM provider';
            btnEl.textContent = 'Configure LLM Provider';
            btnEl.className = 'btn btn-outline-primary w-100';
        }
    }

    updateFilesStatus(message) {
        const statusEl = document.getElementById('files-status');
        if (statusEl) statusEl.textContent = message;
    }

    updateUIState() {
        const isReady = this.prompts && this.fileList && this.llmConfig;
        document.getElementById('user-question').disabled = !isReady;
        document.getElementById('send-btn').disabled = !isReady;
    }

    async handleSendMessage() {
        const question = document.getElementById('user-question').value.trim();
        if (!question) return;

        this.showLoading(true);
        this.addMessage('user', question);
        document.getElementById('user-question').value = '';

        try {
            // Step 1: Route the question to get prompt and files
            const routingDecision = await this.routeQuestion(question);
            this.logDebug('Routing decision:', routingDecision);

            // Step 2: Send the actual query to LLM with selected prompt and files
            await this.processWithLLM(question, routingDecision);

        } catch (error) {
            this.addMessage('assistant', `Error: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async routeQuestion(question) {
        const routingPrompt = `You are a routing assistant for a chat system that answers user questions using a combination of prompts and files.

You are given:
- A list of available prompts ($prompts)
- A list of available files with descriptions ($file-list.txt)
- The user's question ($user_q)

Your job:
1. Select the single most appropriate prompt from $prompts
2. Select one or more relevant files from $file-list.txt
3. Return your decision using the route_question tool

RULES:
- Always choose all the files that are relevant to the question.
- Do not fabricate file names or prompts. Only use from the given lists
- Keep reasoning short and factual
- Do not attempt to answer the question yourself. Only route

$prompts:
${this.prompts}

$file-list.txt:
${this.fileList}

$user_q: ${question}`;

        const tools = [{
            type: "function",
            function: {
                name: "route_question",
                description: "Route a user question to appropriate prompt and files",
                parameters: {
                    type: "object",
                    properties: {
                        chosen_prompt: {
                            type: "string",
                            description: "The selected prompt filename from the prompts list"
                        },
                        chosen_files: {
                            type: "array",
                            items: { type: "string" },
                            description: "Array of selected file names from the file list"
                        },
                        reasoning: {
                            type: "string",
                            description: "Brief reasoning for why these were picked"
                        }
                    },
                    required: ["chosen_prompt", "chosen_files", "reasoning"]
                }
            }
        }];

        this.logDebug('Making LLM call with config:', {
            baseURL: this.llmConfig.baseUrl,
            model: 'gpt-5-mini',
            hasApiKey: !!this.llmConfig.apiKey,
            availableModels: this.llmConfig.models,
            promptLength: routingPrompt.length
        });

        const requestBody = {
            messages: [{ role: 'user', content: routingPrompt }],
            tools: tools,
            tool_choice: { type: "function", function: { name: "route_question" } },
            model: 'gpt-5-mini',
            stream: false
        };

        const url = `${this.llmConfig.baseUrl}/chat/completions`;
        const response = await fetch(url, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json", 
                Authorization: `Bearer ${this.llmConfig.apiKey}` 
            },
            body: JSON.stringify(requestBody)
        });

        const responseData = await response.json();

        this.logDebug('LLM Response received:', JSON.stringify(responseData, null, 2));

        if (responseData.choices?.[0]?.message?.tool_calls?.[0]) {
            return JSON.parse(responseData.choices[0].message.tool_calls[0].function.arguments);
        }
        
        throw new Error(`LLM Response: ${JSON.stringify(responseData, null, 2)}`);
    }

    async processWithLLM(question, routingDecision) {
        this.addMessage('assistant', `🔍 **Routing Decision:**
- **Prompt:** ${routingDecision.chosen_prompt}
- **Files:** ${routingDecision.chosen_files.join(', ')}
- **Reasoning:** ${routingDecision.reasoning}

📝 **Loading prompt and files...**`);

        try {
            // Load the selected prompt
            const promptResponse = await fetch(routingDecision.chosen_prompt);
            if (!promptResponse.ok) throw new Error(`Failed to load prompt: ${routingDecision.chosen_prompt}`);
            const promptContent = await promptResponse.text();
            
            // Load the selected files
            const fileContents = [];
            for (const fileName of routingDecision.chosen_files) {
                try {
                    const fileResponse = await fetch(fileName);
                    if (!fileResponse.ok) throw new Error(`Failed to load file: ${fileName}`);
                    const fileContent = await fileResponse.text();
                    fileContents.push(`--- ${fileName} ---\n${fileContent}`);
                } catch (error) {
                    this.logDebug(`Warning: Could not load file ${fileName}: ${error.message}`);
                    fileContents.push(`--- ${fileName} ---\nError: Could not load file - ${error.message}`);
                }
            }

            const finalPrompt = `${promptContent}

=== CONTEXT FILES ===
${fileContents.join('\n\n')}

=== USER QUESTION ===
${question}`;

            const messageDiv = this.addMessage('assistant', '');
            const contentDiv = messageDiv.querySelector('.message-content');

            const requestBody = {
                messages: [{ role: 'user', content: finalPrompt }],
                model: 'gpt-5-mini',
                stream: true
            };

            const url = `${this.llmConfig.baseUrl}/chat/completions`;
            const stream = asyncLLM(url, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json", 
                    Authorization: `Bearer ${this.llmConfig.apiKey}` 
                },
                body: JSON.stringify(requestBody)
            });

            for await (const { content, error } of stream) {
                if (error) {
                    throw new Error(error);
                }
                if (content) {
                    contentDiv.innerHTML = this.formatMessage(content);
                }
            }

        } catch (error) {
            this.addMessage('assistant', `Error: ${error.message}`);
        }
    }

    addMessage(sender, content) {
        const messagesContainer = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message mb-3 p-3 rounded ${sender === 'user' ? 'bg-primary text-white ms-5' : 'bg-light me-5'}`;
        
        messageDiv.innerHTML = `
            <div class="message-sender fw-bold mb-1">${sender === 'user' ? 'You' : 'Assistant'}</div>
            <div class="message-content">${this.formatMessage(content)}</div>
        `;
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return messageDiv;
    }

    formatMessage(content) {
        // Use marked for proper markdown parsing
        return marked.parse(content);
    }

    showLoading(show) {
        const sendText = document.getElementById('send-text');
        const spinner = document.getElementById('loading-spinner');
        const sendBtn = document.getElementById('send-btn');
        
        if (show) {
            sendText.classList.add('d-none');
            spinner.classList.remove('d-none');
            sendBtn.disabled = true;
        } else {
            sendText.classList.remove('d-none');
            spinner.classList.add('d-none');
            sendBtn.disabled = false;
        }
    }


    logDebug(...args) {
        const debugOutput = document.getElementById('debug-output');
        const timestamp = new Date().toLocaleTimeString();
        const logLine = `[${timestamp}] ${args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
        ).join(' ')}\n`;
        debugOutput.textContent += logLine;
        debugOutput.scrollTop = debugOutput.scrollHeight;
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new RoutingAssistant();
});