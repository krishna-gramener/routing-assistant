import { openaiConfig } from "https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1.2";
import { asyncLLM } from "https://cdn.jsdelivr.net/npm/asyncllm@2/+esm";
import { marked } from "https://cdn.jsdelivr.net/npm/marked@9/+esm";
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/+esm";

const state = { 
    prompts: '', 
    fileList: '', 
    llmConfig: null, 
    messages: [],
    originalPrompts: {},
    config: {
        tone: 'Professional',
        format: 'Summary', 
        language: 'English'
    }
};

const extractTextFromPdf = async (url) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/legacy/build/pdf.worker.min.mjs`;
    const pdf = await pdfjsLib.getDocument({
        url: url,
        withCredentials: true
    }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
    }
    
    return fullText;
};

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
    const container = document.getElementById('chat-messages');
    container.innerHTML = `
        <div class="card-body d-flex align-items-center justify-content-center">
            <div class="text-center text-muted">
                <i class="bi bi-chat-text display-1 mb-3 opacity-25"></i>
                <p class="mb-0">Your healthcare analysis results will appear here</p>
            </div>
        </div>
    `;
    
    // Update reset button state
    updateResetButton();
};

const updateResetButton = () => {
    const resetBtn = document.getElementById('reset-btn');
    if (state.messages.length > 0) {
        resetBtn.classList.remove('btn-outline-secondary');
        resetBtn.classList.add('btn-outline-danger');
        resetBtn.title = 'Reset Chat - Clear conversation history';
    } else {
        resetBtn.classList.remove('btn-outline-danger');
        resetBtn.classList.add('btn-outline-secondary');
        resetBtn.title = 'Reset Chat';
    }
};

const loadFiles = async () => {
    document.getElementById('files-status').textContent = 'Loading...';
    document.getElementById('files-status').className = 'badge bg-warning';
    state.prompts = await (await fetch('prompts.txt')).text();
    state.fileList = await (await fetch('file-list.txt')).text();
    
    // Load and store original prompts for modification
    await loadOriginalPrompts();
    
    document.getElementById('files-status').textContent = 'Ready';
    document.getElementById('files-status').className = 'badge bg-success';
    updateUIState();
};

const loadOriginalPrompts = async () => {
    const promptFiles = [
        'prompts/comparative-assessment-prompt.txt',
        'prompts/data-inquiry-prompt.txt', 
        'prompts/improvement-strategies-prompt.txt',
        'prompts/policy-analysis-prompt.txt'
    ];
    
    for (const file of promptFiles) {
        try {
            state.originalPrompts[file] = await (await fetch(file)).text();
        } catch (error) {
            console.warn(`Could not load ${file}:`, error);
        }
    }
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
        // Auto-collapse settings panel only if it's currently open
        const settingsPanel = document.getElementById('settingsCollapse');
        if (settingsPanel && settingsPanel.classList.contains('show')) {
            const settingsCollapse = bootstrap.Collapse.getInstance(settingsPanel) || new bootstrap.Collapse(settingsPanel);
            settingsCollapse.hide();
        }
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

    const originalPromptContent = state.originalPrompts[decision.chosen_prompt] || await (await fetch(decision.chosen_prompt)).text();
    const promptContent = addConfigToPrompt(originalPromptContent, state.config);
    const fileContents = [];
    
    for (const file of decision.chosen_files) {
        let content;
        if (file.toLowerCase().endsWith('.pdf')) {
            content = await extractTextFromPdf(file);
        } else {
            content = await (await fetch(file)).text();
        }
        fileContents.push(`--- ${file} ---\n${content}`);
    }

    const messageDiv = addMessage('assistant', '');
    const contentDiv = messageDiv.querySelector('.message-content');

    // Build conversation context for system message
    let conversationContext = '';
    if (state.messages.length > 0) {
        conversationContext = '\n\n=== PREVIOUS CONVERSATION CONTEXT ===\n';
        conversationContext += 'Previous questions and answers in this session:\n';
        
        // Include last 3 exchanges (6 messages max) for context
        const recentMessages = state.messages.slice(-6);
        for (let i = 0; i < recentMessages.length; i += 2) {
            if (recentMessages[i] && recentMessages[i + 1]) {
                conversationContext += `\nQ: ${recentMessages[i].content}\n`;
                conversationContext += `A: ${recentMessages[i + 1].content}\n`;
            }
        }
        conversationContext += '\nUse this context to provide more informed responses and avoid repeating information unless specifically asked to do so.\n';
    }

    // Build context with prompts, files, and conversation history
    const systemMessage = {
        role: 'system',
        content: `${promptContent}\n\n=== CONTEXT FILES ===\n${fileContents.join('\n\n')}${conversationContext}`
    };
    
    const chatMessages = [systemMessage, { role: 'user', content: question }];
    
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
    
    // Update reset button state
    updateResetButton();
};

const addMessage = (sender, content) => {
    const container = document.getElementById('chat-messages');
    
    // Clear the empty state if it exists
    const emptyState = container.querySelector('.card-body');
    if (emptyState && emptyState.querySelector('.text-center')) {
        emptyState.innerHTML = '';
        emptyState.className = 'card-body';
    }
    
    const div = document.createElement('div');
    if (sender === 'user') {
        div.className = 'alert alert-primary ms-5 mb-3';
        div.innerHTML = `<div class="fw-semibold mb-2 small text-uppercase">QUERY</div><div class="message-content">${marked.parse(content)}</div>`;
    } else {
        div.className = 'alert alert-light border me-5 mb-3';
        div.innerHTML = `<div class="fw-semibold mb-2 small text-uppercase text-muted">ANALYSIS</div><div class="message-content">${marked.parse(content)}</div>`;
    }
    
    container.querySelector('.card-body').appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
};

const showLoading = (show) => {
    document.getElementById('send-text').classList.toggle('d-none', show);
    document.getElementById('loading-spinner').classList.toggle('d-none', !show);
    document.getElementById('send-btn').disabled = show;
};

const updateConfig = (type, value) => {
    state.config[type] = value;
    updateAllPrompts();
};

const updateAllPrompts = () => {
    // Update each prompt file with current configuration
    for (const [filename, originalContent] of Object.entries(state.originalPrompts)) {
        const updatedContent = addConfigToPrompt(originalContent, state.config);
        // This would normally write to the file, but for runtime we'll store in memory
        state.originalPrompts[filename] = originalContent; // Keep original
        // For processWithLLM, we'll apply config there
    }
};

const addConfigToPrompt = (originalPrompt, config) => {
    const configInstructions = generateConfigInstructions(config);
    return `${originalPrompt}\n\n${configInstructions}`;
};

const generateConfigInstructions = (config) => {
    let instructions = '\nIMPORTANT RESPONSE REQUIREMENTS:\n';
    
    // Tone instructions
    switch(config.tone) {
        case 'Professional':
            instructions += '- Use formal, professional language suitable for government officials\n';
            instructions += '- Maintain objective, analytical tone throughout\n';
            break;
        case 'Casual':
            instructions += '- Use conversational, approachable language\n';
            instructions += '- Keep tone friendly but still informative\n';
            break;
        case 'Informational':
            instructions += '- Focus on clear, factual presentation\n';
            instructions += '- Use neutral, educational tone\n';
            break;
        case 'Enthusiastic':
            instructions += '- Use encouraging, positive language\n';
            instructions += '- Show enthusiasm for improvements and solutions\n';
            break;
    }
    
    // Format instructions  
    switch(config.format) {
        case 'Summary':
            instructions += '- Provide concise summary format\n';
            instructions += '- Focus on key points and main insights\n';
            break;
        case 'Report':
            instructions += '- Use detailed report format with clear sections\n';
            instructions += '- Include comprehensive analysis and background\n';
            break;
        case 'Bullet Points':
            instructions += '- Present information in clear bullet point format\n';
            instructions += '- Use concise, actionable bullet points\n';
            break;
    }
    
    // Language instructions
    if (config.language !== 'English') {
        instructions += `- Respond COMPLETELY in ${config.language} language only\n`;
        instructions += `- Do NOT mix English words or phrases with ${config.language}\n`;
        instructions += `- Use proper ${config.language} terminology for all technical terms\n`;
        instructions += '- Maintain professional vocabulary appropriate for government context\n';
        if (config.language === 'Hindi') {
            instructions += '- Use Devanagari script properly\n';
            instructions += '- Translate all English technical terms to appropriate Hindi equivalents\n';
        }
    }
    
    return instructions;
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('config-llm-btn').addEventListener('click', configureLLM);
    document.getElementById('send-btn').addEventListener('click', handleSendMessage);
    document.getElementById('user-question').addEventListener('keypress', e => e.key === 'Enter' && handleSendMessage());
    
    // Add reset button event listener
    document.getElementById('reset-btn').addEventListener('click', refreshChat);
    
    // Add dropdown event listeners
    document.getElementById('tone-select').addEventListener('change', (e) => {
        updateConfig('tone', e.target.value);
    });
    
    document.getElementById('format-select').addEventListener('change', (e) => {
        updateConfig('format', e.target.value);
    });
    
    document.getElementById('language-select').addEventListener('change', (e) => {
        updateConfig('language', e.target.value);
    });
    
    loadFiles();
    checkExistingConfig();
});