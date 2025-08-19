import { openaiConfig } from "https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1.2";
import { asyncLLM } from "https://cdn.jsdelivr.net/npm/asyncllm@2/+esm";
import { marked } from "https://cdn.jsdelivr.net/npm/marked@9/+esm";

const state = { prompts: '', fileList: '', llmConfig: null, messages: [] };

const configureLLM = async () => {
    state.llmConfig = await openaiConfig({ show: true });
    updateConfigStatus();
    updateUIState();
};

const handleSendMessage = async () => {
    const input = document.getElementById('user-question');
    const question = input.value.trim();
    if (!question) return;
    
    showLoading(true);
    addMessage('user', question);
    state.messages.push({ role: 'user', content: question });
    input.value = '';
    
    const routingDecision = await routeQuestion(question);
    await processWithLLM(question, routingDecision);
    showLoading(false);
};

const refreshChat = () => {
    state.messages = [];
    document.getElementById('chat-messages').innerHTML = '';
};

const loadFiles = async () => {
    document.getElementById('files-status').textContent = 'Loading...';
    document.getElementById('files-status').className = 'badge bg-warning';
    state.prompts = await (await fetch('prompts.txt')).text();
    state.fileList = await (await fetch('file-list.txt')).text();
    document.getElementById('files-status').textContent = 'Ready';
    document.getElementById('files-status').className = 'badge bg-success';
    updateUIState();
};

const checkExistingConfig = async () => {
    try { 
        state.llmConfig = await openaiConfig({ show: false });
        updateConfigStatus();
        updateUIState();
    } catch {}
};

const updateUIState = () => {
    const ready = state.prompts && state.fileList && state.llmConfig;
    document.getElementById('user-question').disabled = !ready;
    document.getElementById('send-btn').disabled = !ready;
};

const updateConfigStatus = () => {
    const status = document.getElementById('config-status');
    const btn = document.getElementById('config-llm-btn');
    if (state.llmConfig) {
        status.textContent = 'Analysis engine active';
        btn.textContent = 'Reconfigure Engine';
        btn.className = 'btn btn-success btn-sm';
        // Hide setup section once configured
        const setupSection = document.getElementById('setup-section');
        if (setupSection) setupSection.style.display = 'none';
    } else {
        status.textContent = 'Click to activate analysis capabilities';
        btn.textContent = 'Initialize Analysis Engine';
        btn.className = 'btn btn-outline-dark btn-sm';
    }
};

const routeQuestion = async (question) => {
    const tools = [{
        type: "function",
        function: {
            name: "route_question",
            parameters: {
                type: "object",
                properties: {
                    chosen_prompt: { type: "string" },
                    chosen_files: { type: "array", items: { type: "string" }},
                    reasoning: { type: "string" }
                },
                required: ["chosen_prompt", "chosen_files", "reasoning"]
            }
        }
    }];

    const response = await fetch(`${state.llmConfig.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { 
            "Content-Type": "application/json", 
            Authorization: `Bearer ${state.llmConfig.apiKey}` 
        },
        body: JSON.stringify({
            messages: [{ role: 'user', content: `Analyze this policy question and select the most appropriate analysis framework and data sources.\n\nAvailable Frameworks:\n${state.prompts}\n\nData Sources:\n${state.fileList}\n\nQuestion: ${question}` }],
            tools,
            tool_choice: { type: "function", function: { name: "route_question" }},
            model: 'gpt-5-mini'
        })
    });

    return JSON.parse((await response.json()).choices[0].message.tool_calls[0].function.arguments);
};

const processWithLLM = async (question, decision) => {
    // Hide technical routing details from government officials
    // addMessage('assistant', `🔍 **Routing:** ${decision.chosen_prompt} | Files: ${decision.chosen_files.join(', ')}`);

    const promptContent = await (await fetch(decision.chosen_prompt)).text();
    const fileContents = [];
    
    for (const file of decision.chosen_files) {
        const content = await (await fetch(file)).text();
        fileContents.push(`--- ${file} ---\n${content}`);
    }

    const messageDiv = addMessage('assistant', '');
    const contentDiv = messageDiv.querySelector('.message-content');

    // Build context with prompts, files, and conversation history
    const systemMessage = {
        role: 'system',
        content: `${promptContent}\n\n=== CONTEXT FILES ===\n${fileContents.join('\n\n')}`
    };
    
    const chatMessages = [systemMessage, ...state.messages.slice(-6), { role: 'user', content: question }];
    
    const stream = asyncLLM(`${state.llmConfig.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { 
            "Content-Type": "application/json", 
            Authorization: `Bearer ${state.llmConfig.apiKey}` 
        },
        body: JSON.stringify({
            messages: chatMessages,
            model: 'gpt-5-mini',
            stream: true
        })
    });
    
    let assistantResponse = '';

    for await (const { content } of stream) {
        if (content) {
            assistantResponse = content;
            contentDiv.innerHTML = marked.parse(content);
        }
    }
    
    state.messages.push({ role: 'assistant', content: assistantResponse });
};

const addMessage = (sender, content) => {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `message mb-3 p-3 rounded-3 ${sender === 'user' ? 'bg-dark text-white ms-4' : 'bg-white border me-4 shadow-sm'}`;
    div.innerHTML = `<div class="fw-semibold mb-2 small text-uppercase ${sender === 'user' ? 'text-light' : 'text-muted'}">${sender === 'user' ? 'Query' : 'Analysis Response'}</div><div class="message-content">${marked.parse(content)}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
};

const showLoading = (show) => {
    document.getElementById('send-text').classList.toggle('d-none', show);
    document.getElementById('loading-spinner').classList.toggle('d-none', !show);
    document.getElementById('send-btn').disabled = show;
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('config-llm-btn').addEventListener('click', configureLLM);
    document.getElementById('send-btn').addEventListener('click', handleSendMessage);
    document.getElementById('user-question').addEventListener('keypress', e => e.key === 'Enter' && handleSendMessage());
    
    // Add refresh button if it exists
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', refreshChat);
    
    loadFiles();
    checkExistingConfig();
});