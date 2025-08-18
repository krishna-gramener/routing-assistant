# Routing Assistant Chat App

A smart chat application that automatically routes your questions to the right prompts and files for accurate answers.

## What Does This App Do?

This app helps you get better answers by:
1. **Analyzing your question** to understand what you need
2. **Selecting the best prompt** from your collection of prompts
3. **Finding relevant files** that contain the information you need
4. **Combining everything** to give you a comprehensive answer

## How to Use

### Step 1: Get Your Files Ready
You'll need two text files:

**Prompts File** - A list of available prompts (one per line or clearly separated)
```
customer-service-prompt.txt
technical-support-prompt.txt
sales-inquiry-prompt.txt
```

**File List** - A description of your available files (format: filename - description)
```
products.csv - Complete product catalog with prices and specifications
faq.md - Frequently asked questions and answers
policies.txt - Company policies and procedures
```

### Step 2: Set Up the App

1. **Open the app** by double-clicking `index.html`
2. **Upload your prompts file** using the "Prompts File" button
3. **Upload your file list** using the "File List" button  
4. **Configure your LLM provider** by clicking "Configure LLM Provider"
   - Enter any OpenAI-compatible API endpoint (text input supports any proxy)
   - Common examples: OpenAI, OpenRouter, local Ollama, Groq, or your own proxy
   - Enter your API key for the chosen provider
   - The configuration is saved automatically for future use

### Step 3: Start Chatting

1. Type your question in the text box
2. Click "Send" or press Enter
3. The app will:
   - Show you which prompt and files it selected
   - Explain why it made those choices
   - Give you a detailed answer

## Example Questions You Can Ask

- "What's the return policy for damaged items?"
- "How do I troubleshoot login issues?"
- "What are the specifications for product XYZ?"
- "What's the process for handling customer complaints?"

## Tips for Better Results

- **Be specific** in your questions
- **Use clear filenames** and descriptions in your file list
- **Keep prompts focused** on specific topics or use cases
- **Update your files regularly** to keep information current

## Troubleshooting

**Nothing happens when I click Send**
- Make sure all three components are configured: prompts file, file list, and LLM provider

**I get an error about the API key**
- Check that your API key is valid for the selected provider
- Make sure you have credits available in your account
- Try reconfiguring your LLM provider

**The app picks wrong files**
- Make your file descriptions more specific
- Include keywords that match the types of questions you ask

**Responses are too slow**
- This is normal for the first response as the app analyzes your files
- Subsequent responses should be faster

## Privacy & Security

- Your LLM configuration is stored securely in your browser's local storage
- Files are processed locally in your browser
- Only your questions and selected content are sent to your chosen LLM provider
- No data is permanently stored on any servers

## Need Help?

If you're having trouble:
1. Check the Debug Panel (click to expand it) for error messages
2. Make sure your internet connection is working
3. Verify your LLM provider configuration is correct
4. Try reconfiguring your LLM provider or refreshing the page