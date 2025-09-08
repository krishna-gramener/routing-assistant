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

const performWebSearch = async (question) => {
  try {
    console.log("🔍 Starting web search for:", question);
    // Check if web search config is available
    const config = window.WEB_SEARCH_CONFIG || {
      provider: 'demo',
      api: {},
      searchParams: { numResults: 5 }
    };
    
    // If no real API is configured, return demo response
    if (config.provider === 'demo' || !config.api[config.provider]?.apiKey || config.api[config.provider].apiKey.includes('YOUR_')) {
      return generateDemoWebSearchResponse(question);
    }
    
    // Perform actual web search based on configured provider
    const searchQuery = encodeURIComponent(question);
    const apiConfig = config.api[config.provider];
    
    let searchUrl, headers, body;
    
    switch (config.provider) {
      case 'google':
        searchUrl = `${apiConfig.baseUrl}?key=${apiConfig.apiKey}&cx=${apiConfig.searchEngineId}&q=${searchQuery}&num=${config.searchParams.numResults}`;
        headers = { 'Content-Type': 'application/json' };
        break;
        
      case 'bing':
        searchUrl = `${apiConfig.baseUrl}?q=${searchQuery}&count=${config.searchParams.numResults}`;
        headers = { 'Ocp-Apim-Subscription-Key': apiConfig.apiKey };
        break;
        
      case 'serpapi':
        searchUrl = `${apiConfig.baseUrl}?api_key=${apiConfig.apiKey}&q=${searchQuery}&num=${config.searchParams.numResults}`;
        headers = { 'Content-Type': 'application/json' };
        break;
        
      default:
        throw new Error(`Unsupported search provider: ${config.provider}`);
    }
    
    // Add CORS proxy for Google Custom Search API
    let actualUrl = searchUrl;
    if (config.provider === 'google') {
      // Use a CORS proxy to avoid CORS issues
      actualUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(searchUrl)}`;
    }
    
    const response = await fetch(actualUrl, { headers });
    
    if (!response.ok) {
      throw new Error(`Search API error: ${response.status} - ${response.statusText}`);
    }
    
    let searchData;
    if (config.provider === 'google') {
      // Parse the CORS proxy response
      const proxyData = await response.json();
      searchData = JSON.parse(proxyData.contents);
    } else {
      searchData = await response.json();
    }
    
    return formatSearchResults(searchData, config.provider);
    
  } catch (error) {
    console.error('Web search error:', error);
    return `=== WEB SEARCH ERROR ===\n\nUnable to perform web search: ${error.message}\n\nFalling back to demo mode. To enable real web search, configure your API keys in web-search-config.js`;
  }
};

const generateDemoWebSearchResponse = (question) => {
  let formattedResults = "=== WEB SEARCH RESULTS (DEMO MODE) ===\n\n";
  formattedResults += "🔍 **Search Query:** " + question + "\n\n";
  formattedResults += "**Note:** This is a demo response. To enable real web search:\n\n";
  formattedResults += "1. **Choose a search API provider:**\n";
  formattedResults += "   - Google Custom Search API (recommended)\n";
  formattedResults += "   - Bing Search API\n";
  formattedResults += "   - SerpAPI\n\n";
  formattedResults += "2. **Configure your API keys in `web-search-config.js`**\n\n";
  formattedResults += "3. **Example configuration:**\n";
  formattedResults += "```javascript\n";
  formattedResults += "const WEB_SEARCH_CONFIG = {\n";
  formattedResults += "  provider: 'google',\n";
  formattedResults += "  api: {\n";
  formattedResults += "    google: {\n";
  formattedResults += "      apiKey: 'YOUR_ACTUAL_API_KEY',\n";
  formattedResults += "      searchEngineId: 'YOUR_SEARCH_ENGINE_ID'\n";
  formattedResults += "    }\n";
  formattedResults += "  }\n";
  formattedResults += "};\n";
  formattedResults += "```\n\n";
  formattedResults += "**Sample Results (what you would get with real API):**\n\n";
  formattedResults += "Result 1:\n";
  formattedResults += "Title: Latest Maternal Health Policies in India 2024\n";
  formattedResults += "URL: https://mohfw.gov.in/maternal-health-policies\n";
  formattedResults += "Content: The Ministry of Health and Family Welfare has announced new initiatives...\n\n";
  formattedResults += "Result 2:\n";
  formattedResults += "Title: WHO Guidelines for Maternal Mortality Reduction\n";
  formattedResults += "URL: https://who.int/maternal-health-guidelines\n";
  formattedResults += "Content: Updated WHO recommendations for reducing maternal mortality rates...\n\n";
  formattedResults += "**Benefits of Web Search Integration:**\n";
  formattedResults += "- Access to current policy updates\n";
  formattedResults += "- Latest research findings\n";
  formattedResults += "- International best practices\n";
  formattedResults += "- Real-time health statistics\n";
  formattedResults += "- Government announcements and initiatives\n\n";
  formattedResults += "Once configured, the system will automatically search for current information relevant to your healthcare policy questions.";
  
  return formattedResults;
};

const formatSearchResults = (searchData, provider) => {
  let formattedResults = "=== WEB SEARCH RESULTS ===\n\n";
  
  let results = [];
  
  switch (provider) {
    case 'google':
      results = searchData.items || [];
      break;
    case 'bing':
      results = searchData.webPages?.value || [];
      break;
    case 'serpapi':
      results = searchData.organic_results || [];
      break;
  }
  
  if (results.length > 0) {
    results.forEach((result, index) => {
      formattedResults += `Result ${index + 1}:\n`;
      formattedResults += `Title: ${result.title || 'No title'}\n`;
      formattedResults += `URL: ${result.url || result.link || 'No URL'}\n`;
      formattedResults += `Content: ${result.snippet || result.description || result.content || 'No content available'}\n\n`;
    });
  } else {
    formattedResults += "No search results found for the query.\n";
  }
  
  return formattedResults;
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
        <i class="bi bi-graph-up-arrow display-1 mb-3 opacity-25"></i>
        <h5 class="fw-light">Healthcare Data Analysis Ready</h5>
        <p class="mb-0">Submit your query below to receive comprehensive analysis and insights</p>
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

  // Check if elements exist (they don't in the new interface)
  if (!followupCard || !followupContainer || !followupLoading) {
    // For new interface, get dynamic suggestions from LLM
    if (typeof window.updateSuggestions === 'function') {
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
      
      // Convert LLM questions to suggestion format
      const dynamicSuggestions = followupData.questions.map((question, index) => ({
        title: question.split('?')[0].substring(0, 30) + (question.split('?')[0].length > 30 ? '...' : ''),
        description: question
      }));
      
      window.updateSuggestions(dynamicSuggestions);
    }
    return;
  }

  // Show the card and loading state (old interface)
  followupCard.classList.remove("d-none");
  followupLoading.classList.remove("d-none");
  followupContainer.innerHTML = "";

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
  
  // Hide loading and display questions (old interface only)
  if (followupLoading) followupLoading.classList.add("d-none");
  displayFollowUpQuestions(followupData.questions);
};

const displayFollowUpQuestions = (questions) => {
  const container = document.getElementById("followup-questions-container");
  
  // Check if container exists (doesn't in new interface)
  if (!container) {
    return;
  }
  
  // Check if html template function is available
  if (typeof html === 'undefined') {
    return;
  }
  
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
  
  // Set loading state (check if element exists for new interface compatibility)
  if (filesStatus) {
    filesStatus.textContent = "Loading...";
    filesStatus.className = "badge bg-warning";
  }
  
  try {
    state.prompts = await (await fetch("prompts.txt")).text();
    state.fileList = await (await fetch("file-list.txt")).text();

    // Load and store original prompts for modification
    await loadOriginalPrompts();

    // Set success state (check if element exists)
    if (filesStatus) {
      filesStatus.textContent = "Ready";
      filesStatus.className = "badge bg-success";
    }
  } catch (error) {
    // Set error state (check if element exists)
    if (filesStatus) {
      filesStatus.textContent = "Error";
      filesStatus.className = "badge bg-danger";
    }
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
    status.textContent = "Analysis engine operational";
    btn.textContent = "Reconfigure Analysis Engine";
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
          content: `Analyze this policy question and select the most appropriate analysis framework and data sources.

IMPORTANT ROUTING RULES:
- For questions about CURRENT/LATEST policies, updates, or recent information → Use "web-search" ONLY (must include "web-search" in chosen_files array)
- For questions about district rankings, comparisons, or historical data analysis → Use local data files ONLY
- NEVER combine web-search with local data files for the same question
- You MUST select at least one data source from the list below
- If using Web_Search_Analysis.txt prompt, you MUST include "web-search" in chosen_files

Available Frameworks:
${state.prompts}

Data Sources:
${state.fileList}

Question: ${question}`,
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
  // Log routing decision to console for debugging
  console.log("🎯 ROUTING DECISION:", {
    prompt: decision.chosen_prompt,
    files: decision.chosen_files,
    reasoning: decision.reasoning
  });

  // Safety check: If using Web_Search_Analysis.txt but no files selected, add web-search
  if (decision.chosen_prompt.includes('Web_Search_Analysis.txt') && decision.chosen_files.length === 0) {
    console.log("⚠️ AUTO-CORRECTING: Adding web-search for Web_Search_Analysis prompt");
    decision.chosen_files = ['web-search'];
  }

  const originalPromptContent =
    state.originalPrompts[decision.chosen_prompt] ||
    (await (await fetch(decision.chosen_prompt)).text());
  const promptContent = addConfigToPrompt(originalPromptContent, state.config);
  const fileContents = [];

  // Show loading indicator for file processing
  showFileProcessingIndicator();

  for (const file of decision.chosen_files) {
    let content;
    if (file === "web-search") {
      // Handle web search
      console.log("🌐 Using WEB SEARCH for current information");
      content = await performWebSearch(question);
    } else if (file.toLowerCase().endsWith(".pdf")) {
      console.log("📄 Using PDF data:", file);
      content = await extractTextFromPdf(file);
    } else if (file.toLowerCase().endsWith(".xlsx")) {
      console.log("📊 Using Excel data:", file);
      content = await extractTextFromExcel(file);
    } else {
      console.log("📁 Using text data:", file);
      content = await (await fetch(file)).text();
    }
    fileContents.push(`--- ${file} ---\n${content}`);
  }

  // Hide file processing indicator
  hideFileProcessingIndicator();

  // For new interface, addMessage handles AI responses differently
  let messageDiv, contentDiv, streamingMessageId;
  
  if (typeof window.addAIMessage === 'function') {
    // Start with empty message that will be updated
    contentDiv = { textContent: "" };
    
    // Create a mock messageDiv for compatibility
    messageDiv = {
      querySelector: () => contentDiv
    };
    
    // Create streaming message for new interface
    streamingMessageId = createStreamingMessage();
  } else {
    // Use the old interface
    messageDiv = addMessage("assistant", "");
    contentDiv = messageDiv.querySelector(".message-content");
  }

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

  // Show streaming indicator
  showStreamingIndicator();

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
  let isFirstChunk = true;

  for await (const { content } of stream) {
    if (content) {
      assistantResponse = content;
      
      // Handle new interface vs old interface
      if (typeof window.addAIMessage === 'function') {
        // Update streaming message in new interface
        updateStreamingMessage(streamingMessageId, content, isFirstChunk);
      } else {
        // Old interface - update the content div with streaming effect
        contentDiv.innerHTML = marked.parse(content) + '<span class="streaming-cursor"></span>';
      }
      
      isFirstChunk = false;
    }
  }
  
  // Hide streaming indicator
  hideStreamingIndicator();
  
  // Remove streaming cursor and finalize message
  if (typeof window.addAIMessage === 'function') {
    finalizeStreamingMessage(streamingMessageId, assistantResponse);
  } else {
    // Remove streaming cursor from old interface
    const cursor = contentDiv.querySelector('.streaming-cursor');
    if (cursor) cursor.remove();
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
  // Check if we're using the new interface
  if (typeof window.addAIMessage === 'function' && sender === 'ai') {
    window.addAIMessage(content, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    return;
  }
  
  const container = document.getElementById("chat-messages");
  
  // Fallback for old interface
  if (!container) return;

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
  // Check if we're using the new interface
  if (typeof window.setLoadingState === 'function') {
    window.setLoadingState(show);
    return;
  }
  
  // Fallback for old interface
  const sendText = document.getElementById("send-text");
  const loadingSpinner = document.getElementById("loading-spinner");
  const sendBtn = document.getElementById("send-btn");
  
  if (!sendBtn) return;
  
  // Use modern toggle methods for cleaner code
  if (sendText) sendText.classList.toggle("d-none", show);
  if (loadingSpinner) loadingSpinner.classList.toggle("d-none", !show);
  sendBtn.disabled = show;
  
  // Update button text for professional context
  if (show) {
    sendText.textContent = "Analyzing...";
  } else {
    sendText.textContent = "Analyze";
  }
};

// New loading indicator functions
const showFileProcessingIndicator = () => {
  if (typeof window.showFileProcessing === 'function') {
    window.showFileProcessing();
  } else {
    // Fallback for old interface
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.id = 'file-processing-indicator';
    loadingIndicator.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text">Processing data files...</div>
    `;
    
    const chatArea = document.getElementById('chat-area');
    if (chatArea) {
      chatArea.appendChild(loadingIndicator);
    }
  }
};

const hideFileProcessingIndicator = () => {
  if (typeof window.hideFileProcessing === 'function') {
    window.hideFileProcessing();
  } else {
    // Fallback for old interface
    const indicator = document.getElementById('file-processing-indicator');
    if (indicator) {
      indicator.remove();
    }
  }
};

const showStreamingIndicator = () => {
  if (typeof window.showStreaming === 'function') {
    window.showStreaming();
  } else {
    // Fallback for old interface
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.id = 'streaming-indicator';
    loadingIndicator.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text">Generating response...</div>
    `;
    
    const chatArea = document.getElementById('chat-area');
    if (chatArea) {
      chatArea.appendChild(loadingIndicator);
    }
  }
};

const hideStreamingIndicator = () => {
  if (typeof window.hideStreaming === 'function') {
    window.hideStreaming();
  } else {
    // Fallback for old interface
    const indicator = document.getElementById('streaming-indicator');
    if (indicator) {
      indicator.remove();
    }
  }
};

// Streaming message functions for new interface
const createStreamingMessage = () => {
  if (typeof window.createStreamingMessage === 'function') {
    return window.createStreamingMessage();
  }
  return null;
};

const updateStreamingMessage = (messageId, content, isFirstChunk) => {
  if (typeof window.updateStreamingMessage === 'function') {
    window.updateStreamingMessage(messageId, content, isFirstChunk);
  }
};

const finalizeStreamingMessage = (messageId, finalContent) => {
  if (typeof window.finalizeStreamingMessage === 'function') {
    window.finalizeStreamingMessage(messageId, finalContent);
  }
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
      instructions += "- Provide executive summary format suitable for senior officials\n";
      instructions += "- Focus on key findings, implications, and actionable recommendations\n";
      instructions += "- Use professional language appropriate for government decision-making\n";
      break;
    case "e-mail":
      instructions += "- Format as an official memorandum\n";
      instructions += "- Include appropriate subject line, formal greeting, and professional closing\n";
      instructions += "- Use clear sections and authoritative tone suitable for official communication\n";
      break;
    case "Bullet Points":
      instructions += "- Present information as a policy brief with clear bullet points\n";
      instructions += "- Use concise, actionable bullet points with policy implications\n";
      instructions += "- Structure for quick decision-making by government officials\n";
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

// Expose functions for the new interface
window.handleUserQuestion = async (question, format, language) => {
  // Set the format and language
  const formatSelect = document.getElementById("format-select");
  const languageSelect = document.getElementById("language-select");
  
  if (formatSelect) {
    // Update the display value in the new interface
    const formatValue = document.getElementById("format-value");
    if (formatValue) formatValue.textContent = format;
  }
  
  if (languageSelect) {
    // Update the display value in the new interface  
    const languageValue = document.getElementById("language-value");
    if (languageValue) languageValue.textContent = language;
  }
  
  // Process the question
  showLoading(true);
  state.messages.push({ role: "user", content: question });
  
  const routingDecision = await routeQuestion(question);
  await processWithLLM(question, routingDecision);
  showLoading(false);
};

window.resetAnalysis = () => {
  refreshChat();
};

window.initializeApp = async () => {
  await loadFiles();
  await checkExistingConfig();
  return state;
};
