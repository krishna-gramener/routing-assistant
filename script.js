import { openaiConfig } from "https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1.2";
import { asyncLLM } from "https://cdn.jsdelivr.net/npm/asyncllm@2/+esm";
import { marked } from "https://cdn.jsdelivr.net/npm/marked@9/+esm";
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/+esm";
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
import { html, render } from 'https://cdn.jsdelivr.net/npm/lit-html@3/lit-html.js';
import { SpeechManager } from './speech.js';

// Configure marked to handle tables and other extensions
marked.use({
  gfm: true, // GitHub Flavored Markdown
  breaks: true,
  tables: true,
  renderer: {
    table(header, body) {
      return `<div class="table-responsive my-3">
                <table class="table table-striped table-bordered table-hover border border-dark">
                    <thead class="table-dark">
                        ${header}
                    </thead>
                    <tbody>
                        ${body}
                    </tbody>
                </table>
            </div>`;
    },
  },
});

const state = {
  prompts: "",
  fileList: "",
  llmConfig: null,
  messages: [],
  originalPrompts: {},
  config: {
    format: "Summary",
    language: "English",
  },
  speechManager: null,
};

const extractTextFromPdf = async (url) => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/legacy/build/pdf.worker.min.mjs`;
  const pdf = await pdfjsLib.getDocument({
    url: url,
    withCredentials: true,
  }).promise;
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ");
    fullText += pageText + "\n";
  }

  return fullText;
};

const extractTextFromExcel = async (url) => {
  const response = await fetch(url);
  
  // Check if we got a valid response
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  
  // Check content type to ensure it's not HTML
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('text/html')) {
    throw new Error(`Expected Excel file but got HTML content for ${url}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  
  // Check if the arrayBuffer has content
  if (arrayBuffer.byteLength === 0) {
    throw new Error(`Empty file: ${url}`);
  }
  
  const workbook = XLSX.read(arrayBuffer, { type: "buffer" });

  let fullText = "";

  // Process each sheet
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (jsonData.length > 0) {
      fullText += `\n=== SHEET: ${sheetName} ===\n`;

      // Get headers from first row
      const headers = jsonData[0] || [];
      fullText += `Headers: ${headers.join(" | ")}\n\n`;

      // Process data rows
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (
          row &&
          row.some((cell) => cell !== null && cell !== undefined && cell !== "")
        ) {
          const rowText = row
            .map((cell, index) => {
              const header = headers[index] || `Column${index + 1}`;
              return `${header}: ${cell || ""}`;
            })
            .join(" | ");
          fullText += `Row ${i}: ${rowText}\n`;
        }
      }
      fullText += "\n";
    }
  }

  return fullText.trim();
};

const configureLLM = async () => {
  state.llmConfig = await openaiConfig({ show: true });
  updateConfigStatus();
  updateUIState();
};

const handleSendMessage = async () => {
  const input = document.getElementById("user-question");
  const question = input.value.trim();
  if (!question) return;

  // Hide follow-up questions when a new question is asked
  const followupCard = document.getElementById("followup-questions-card");
  followupCard.classList.add("d-none");

  showLoading(true);
  addMessage("user", question);
  state.messages.push({ role: "user", content: question });
  input.value = "";

  const routingDecision = await routeQuestion(question);
  await processWithLLM(question, routingDecision);
  showLoading(false);
};

const refreshChat = () => {
  state.messages = [];
  const container = document.getElementById("chat-messages");
  
  // Create empty state template using lit-html
  const emptyStateTemplate = html`
    <div class="card-body d-flex align-items-center justify-content-center">
      <div class="text-center text-muted">
        <i class="bi bi-chat-text display-1 mb-3 opacity-25"></i>
        <p class="mb-0">Your healthcare analysis results will appear here</p>
      </div>
    </div>
  `;
  
  render(emptyStateTemplate, container);
  
  // Hide follow-up questions card
  const followupCard = document.getElementById("followup-questions-card");
  followupCard.classList.add("d-none");
  
  // Update reset button state
  updateResetButton();
};

const updateResetButton = () => {
  const resetBtn = document.getElementById("reset-btn");
  const hasMessages = state.messages.length > 0;
  
  // Use modern classList methods and conditional logic
  resetBtn.classList.toggle("btn-outline-danger", hasMessages);
  resetBtn.classList.toggle("btn-outline-secondary", !hasMessages);
  resetBtn.title = hasMessages ? "Reset Chat - Clear conversation history" : "Reset Chat";
};

const generateFollowUpQuestions = async (userQuestion, assistantResponse) => {
  const followupCard = document.getElementById("followup-questions-card");
  const followupContainer = document.getElementById("followup-questions-container");
  const followupLoading = document.getElementById("followup-loading");

  // Show the card and loading state
  followupCard.classList.remove("d-none");
  followupLoading.classList.remove("d-none");
  followupContainer.innerHTML = "";

  try {
    const tools = [
      {
        type: "function",
        function: {
          name: "generate_followup_questions",
          parameters: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                items: { type: "string" },
                description: "Array of 3-4 contextual follow-up questions"
              },
              reasoning: { type: "string", description: "Why these questions are relevant" }
            },
            required: ["questions", "reasoning"]
          }
        }
      }
    ];

    const followupPrompt = `
You are an expert policy analyst helping government officials explore healthcare data. 
Based on the user's question and the analysis provided, generate 3-4 highly relevant follow-up questions that would naturally extend the conversation and provide additional insights.

Guidelines for follow-up questions:
1. Build on the current analysis to explore deeper insights
2. Focus on actionable policy implications  
3. Suggest comparative analysis with other regions/metrics
4. Explore root causes or intervention strategies
5. Be specific and data-driven
6. Use clear, professional language suitable for government officials

Original Question: "${userQuestion}"
Analysis Provided: "${assistantResponse.substring(0, 1000)}..."

Available data includes: maternal mortality rates, anemia prevalence, iron-folic acid consumption, healthcare facility utilization, and district-level health indicators.

Generate questions that would help the official make informed policy decisions or understand the data more comprehensively.
`;

    const response = await fetch(`${state.llmConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.llmConfig.apiKey}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: followupPrompt }],
        tools,
        tool_choice: { type: "function", function: { name: "generate_followup_questions" } },
        model: "gpt-4.1-mini",
      }),
    });

    const result = await response.json();
    const followupData = JSON.parse(result.choices[0].message.tool_calls[0].function.arguments);
    
    // Hide loading and display questions
    followupLoading.classList.add("d-none");
    displayFollowUpQuestions(followupData.questions);

  } catch (error) {
    console.error("Failed to generate follow-up questions:", error);
    followupLoading.classList.add("d-none");
    followupContainer.innerHTML = `
      <div class="text-muted text-center">
        <small>Unable to generate follow-up questions at this time.</small>
      </div>
    `;
  }
};

const displayFollowUpQuestions = (questions) => {
  const container = document.getElementById("followup-questions-container");
  
  const questionsTemplate = html`
    ${questions.map((question, index) => html`
      <button 
        class="btn btn-outline-primary text-start followup-question-btn d-flex align-items-center" 
        data-question="${question}"
        @click=${() => handleFollowUpClick(question)}
      >
        <i class="bi bi-arrow-right-circle me-2 flex-shrink-0"></i>
        <span class="text-truncate">${question}</span>
      </button>
    `)}
  `;
  
  render(questionsTemplate, container);
};

const handleFollowUpClick = (question) => {
  const userQuestionInput = document.getElementById("user-question");
  const sendButton = document.getElementById("send-btn");
  
  // Fill the input field with the follow-up question
  userQuestionInput.value = question;
  
  // Hide the follow-up questions card after selection
  const followupCard = document.getElementById("followup-questions-card");
  followupCard.classList.add("d-none");
  
  // Trigger the send button to submit the question
  sendButton.click();
};

const loadFiles = async () => {
  const filesStatus = document.getElementById("files-status");
  
  // Set loading state
  filesStatus.textContent = "Loading...";
  filesStatus.className = "badge bg-warning";
  
  try {
    state.prompts = await (await fetch("prompts.txt")).text();
    state.fileList = await (await fetch("file-list.txt")).text();

    // Load and store original prompts for modification
    await loadOriginalPrompts();

    // Set success state
    filesStatus.textContent = "Ready";
    filesStatus.className = "badge bg-success";
  } catch (error) {
    // Set error state
    filesStatus.textContent = "Error";
    filesStatus.className = "badge bg-danger";
    console.error("Failed to load files:", error);
  }
  
  updateUIState();
};

const loadOriginalPrompts = async () => {
  try {
    // Get the list of files in the prompts directory
    const response = await fetch("prompts/");
    const text = await response.text();

    // Parse the directory listing to extract filenames
    const fileMatches = text.match(/href="([^"]+\.txt)"/g);
    if (fileMatches) {
      const promptFiles = fileMatches.map((match) => {
        const filename = match.match(/href="([^"]+)"/)[1];
        return `prompts/${filename}`;
      });

      // Load each prompt file
      for (const file of promptFiles) {
        try {
          state.originalPrompts[file] = await (await fetch(file)).text();
          console.log(`Loaded prompt: ${file}`);
        } catch (error) {
          console.warn(`Could not load ${file}:`, error);
        }
      }
    }
  } catch (error) {
    console.warn("Could not fetch prompts directory listing:", error);
    // Fallback to known files if directory listing fails
    const fallbackFiles = [
      "prompts/system_prompt_mmr.txt",
      "prompts/system_prompt_mmr_data_only.txt",
    ];

    for (const file of fallbackFiles) {
      try {
        state.originalPrompts[file] = await (await fetch(file)).text();
        console.log(`Loaded fallback prompt: ${file}`);
      } catch (error) {
        console.warn(`Could not load fallback ${file}:`, error);
      }
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
  document.getElementById("user-question").disabled = !ready;
  document.getElementById("send-btn").disabled = !ready;
};

const updateConfigStatus = () => {
  const status = document.getElementById("config-status");
  const btn = document.getElementById("config-llm-btn");
  if (state.llmConfig) {
    status.textContent = "Analysis engine active";
    btn.textContent = "Reconfigure Engine";
    btn.className = "btn btn-success btn-sm";
    // Auto-collapse settings panel only if it's currently open
    const settingsPanel = document.getElementById("settingsCollapse");
    if (settingsPanel && settingsPanel.classList.contains("show")) {
      const settingsCollapse =
        bootstrap.Collapse.getInstance(settingsPanel) ||
        new bootstrap.Collapse(settingsPanel);
      settingsCollapse.hide();
    }
  } else {
    status.textContent = "Click to activate analysis capabilities";
    btn.textContent = "Initialize Analysis Engine";
    btn.className = "btn btn-outline-dark btn-sm";
  }
};

const routeQuestion = async (question) => {
  const tools = [
    {
      type: "function",
      function: {
        name: "route_question",
        parameters: {
          type: "object",
          properties: {
            chosen_prompt: { type: "string" },
            chosen_files: { type: "array", items: { type: "string" } },
            reasoning: { type: "string" },
          },
          required: ["chosen_prompt", "chosen_files", "reasoning"],
        },
      },
    },
  ];

  const response = await fetch(`${state.llmConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: `Analyze this policy question and select the most appropriate analysis framework and data sources.\n\nAvailable Frameworks:\n${state.prompts}\n\nData Sources:\n${state.fileList}\n\nQuestion: ${question}`,
        },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "route_question" } },
      model: "gpt-4.1-mini",
    }),
  });

  return JSON.parse(
    (await response.json()).choices[0].message.tool_calls[0].function.arguments
  );
};

const processWithLLM = async (question, decision) => {
  // Hide technical routing details from government officials
  // addMessage('assistant', `🔍 **Routing:** ${decision.chosen_prompt} | Files: ${decision.chosen_files.join(', ')}`);

  const originalPromptContent =
    state.originalPrompts[decision.chosen_prompt] ||
    (await (await fetch(decision.chosen_prompt)).text());
  const promptContent = addConfigToPrompt(originalPromptContent, state.config);
  const fileContents = [];

  for (const file of decision.chosen_files) {
    let content;
    if (file.toLowerCase().endsWith(".pdf")) {
      content = await extractTextFromPdf(file);
    } else if (file.toLowerCase().endsWith(".xlsx")) {
      content = await extractTextFromExcel(file);
    } else {
      content = await (await fetch(file)).text();
    }
    fileContents.push(`--- ${file} ---\n${content}`);
  }

  const messageDiv = addMessage("assistant", "");
  const contentDiv = messageDiv.querySelector(".message-content");

  // Build conversation context for system message
  let conversationContext = "";
  if (state.messages.length > 0) {
    conversationContext = "\n\n=== PREVIOUS CONVERSATION CONTEXT ===\n";
    conversationContext += "Previous questions and answers in this session:\n";

    // Include last 3 exchanges (6 messages max) for context
    const recentMessages = state.messages.slice(-6);
    for (let i = 0; i < recentMessages.length; i += 2) {
      if (recentMessages[i] && recentMessages[i + 1]) {
        conversationContext += `\nQ: ${recentMessages[i].content}\n`;
        conversationContext += `A: ${recentMessages[i + 1].content}\n`;
      }
    }
    conversationContext +=
      "\nUse this context to provide more informed responses and avoid repeating information unless specifically asked to do so.\n";
  }

  // Build context with prompts, files, and conversation history
  const systemMessage = {
    role: "system",
    content: `${promptContent}\n\n=== CONTEXT FILES ===\n${fileContents.join(
      "\n\n"
    )}${conversationContext}`,
  };

  const chatMessages = [systemMessage, { role: "user", content: question }];

  const stream = asyncLLM(`${state.llmConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      messages: chatMessages,
      model: "gpt-4.1-mini",
      stream: true,
    }),
  });

  let assistantResponse = "";

  for await (const { content } of stream) {
    if (content) {
      assistantResponse = content;
      contentDiv.innerHTML = marked.parse(content);
    }
  }

  state.messages.push({ role: "assistant", content: assistantResponse });

  // Generate follow-up questions after the first response
  if (state.messages.length >= 2) { // User question + assistant response
    await generateFollowUpQuestions(question, assistantResponse);
  }

  // Update reset button state
  updateResetButton();
};

const addMessage = (sender, content) => {
  const container = document.getElementById("chat-messages");

  // Clear the empty state if it exists
  const emptyState = container.querySelector(".card-body");
  if (emptyState && emptyState.querySelector(".text-center")) {
    emptyState.innerHTML = "";
    emptyState.className = "card-body";
  }

  const copyButtonId = `copy-btn-${Date.now()}`;
  
  // Create message template using lit-html
  let messageTemplate;
  
  if (sender === "user") {
    messageTemplate = html`
      <div class="alert alert-primary ms-5 mb-3">
        <div class="fw-semibold mb-2 small text-uppercase">QUERY</div>
        <div class="message-content">${content}</div>
      </div>
    `;
  } else {
    messageTemplate = html`
      <div class="alert alert-light border me-5 mb-3 position-relative">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div class="fw-semibold small text-uppercase text-muted">ANALYSIS</div>
          <button 
            class="btn btn-outline-secondary btn-sm copy-btn" 
            id="${copyButtonId}" 
            title="Copy response"
            @click=${(e) => {
              const messageContent = e.target.closest('.alert').querySelector('.message-content');
              copyToClipboard(messageContent, e.target);
            }}
          >
            <i class="bi bi-clipboard"></i>
          </button>
        </div>
        <div class="message-content"></div>
      </div>
    `;
  }

  // Create a temporary container for the message
  const tempDiv = document.createElement('div');
  render(messageTemplate, tempDiv);
  
  const messageElement = tempDiv.firstElementChild;
  
  // For assistant messages, set the parsed markdown content
  if (sender !== "user") {
    const messageContent = messageElement.querySelector('.message-content');
    messageContent.innerHTML = marked.parse(content);
  }
  
  // Append the rendered message to the chat body
  const chatBody = container.querySelector(".card-body");
  chatBody.appendChild(messageElement);
  
  // Auto-scroll to the latest message with smooth animation
  setTimeout(() => {
    chatBody.scrollTop = chatBody.scrollHeight;
  }, 100);
  
  return messageElement;
};

const copyToClipboard = async (contentElement, button) => {
  let textToCopy = '';
  
  // Extract text content from the DOM element
  if (contentElement && contentElement.textContent) {
    textToCopy = contentElement.textContent.trim();
  } else {
    console.error('No content element found to copy');
    showCopyError(button);
    return;
  }
  
  // Try modern clipboard API first
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(textToCopy);
      showCopySuccess(button);
      return;
    } catch (err) {
      console.warn('Clipboard API failed, trying fallback method:', err);
    }
  }
  
  // Fallback method using document.execCommand (deprecated but still works)
  try {
    const textArea = document.createElement('textarea');
    textArea.value = textToCopy;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    
    if (successful) {
      showCopySuccess(button);
    } else {
      throw new Error('execCommand copy failed');
    }
  } catch (err) {
    console.error('All copy methods failed:', err);
    showCopyError(button);
  }
};

const showCopySuccess = (button) => {
  const originalHTML = button.innerHTML;
  const originalClasses = button.className;
  
  button.innerHTML = '<i class="bi bi-check-lg text-success"></i>';
  button.classList.add('btn-outline-success');
  button.classList.remove('btn-outline-secondary');
  
  setTimeout(() => {
    button.innerHTML = originalHTML;
    button.className = originalClasses;
  }, 2000);
};

const showCopyError = (button) => {
  const originalHTML = button.innerHTML;
  const originalClasses = button.className;
  
  button.innerHTML = '<i class="bi bi-exclamation-triangle text-danger"></i>';
  button.classList.add('btn-outline-danger');
  button.classList.remove('btn-outline-secondary');
  
  setTimeout(() => {
    button.innerHTML = originalHTML;
    button.className = originalClasses;
  }, 2000);
};

const showLoading = (show) => {
  const sendText = document.getElementById("send-text");
  const loadingSpinner = document.getElementById("loading-spinner");
  const sendBtn = document.getElementById("send-btn");
  
  // Use modern toggle methods for cleaner code
  sendText.classList.toggle("d-none", show);
  loadingSpinner.classList.toggle("d-none", !show);
  sendBtn.disabled = show;
};

const updateConfig = (type, value) => {
  state.config[type] = value;
  updateAllPrompts();
};

const updateAllPrompts = () => {
  // Update each prompt file with current configuration
  for (const [filename, originalContent] of Object.entries(
    state.originalPrompts
  )) {
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
  let instructions = "\nIMPORTANT RESPONSE REQUIREMENTS:\n";

  // Format instructions
  switch (config.format) {
    case "Summary":
      instructions += "- Provide concise summary format\n";
      instructions += "- Focus on key points and main insights\n";
      break;
    case "e-mail":
      instructions += "- Format as a professional e-mail\n";
      instructions += "- Include appropriate subject line, greeting, and closing\n";
      instructions += "- Use clear sections and professional tone suitable for email communication\n";
      break;
    case "Bullet Points":
      instructions += "- Present information in clear bullet point format\n";
      instructions += "- Use concise, actionable bullet points\n";
      break;
  }

  // Language instructions
  if (config.language !== "English") {
    instructions += `- Respond COMPLETELY in ${config.language} language only\n`;
    instructions += `- Do NOT mix English words or phrases with ${config.language}\n`;
    instructions += `- Use proper ${config.language} terminology for all technical terms\n`;
    instructions +=
      "- Maintain professional vocabulary appropriate for government context\n";
    if (config.language === "Hindi") {
      instructions += "- Use Devanagari script properly\n";
      instructions +=
        "- Translate all English technical terms to appropriate Hindi equivalents\n";
    }
  }

  return instructions;
};

// Modern event handling using a centralized approach
const initializeEventListeners = () => {
  const elements = {
    configLlmBtn: document.getElementById("config-llm-btn"),
    sendBtn: document.getElementById("send-btn"),
    userQuestion: document.getElementById("user-question"),
    resetBtn: document.getElementById("reset-btn"),
    formatSelect: document.getElementById("format-select"),
    languageSelect: document.getElementById("language-select")
  };

  // Configuration button
  elements.configLlmBtn?.addEventListener("click", configureLLM);

  // Send button  
  elements.sendBtn?.addEventListener("click", handleSendMessage);

  // Enter key handling for question input
  elements.userQuestion?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  });

  // Reset button
  elements.resetBtn?.addEventListener("click", refreshChat);

  // Dropdown change handlers using modern approach
  elements.formatSelect?.addEventListener("change", (e) => {
    updateConfig("format", e.target.value);
  });

  elements.languageSelect?.addEventListener("change", (e) => {
    updateConfig("language", e.target.value);
  });
};

document.addEventListener("DOMContentLoaded", () => {
  initializeEventListeners();
  
  // Initialize speech manager
  state.speechManager = new SpeechManager();
  state.speechManager.initializeSpeechControls();
  state.speechManager.observeChatChanges();
  
  loadFiles();
  checkExistingConfig();
});
