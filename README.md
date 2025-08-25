# Healthcare Data Insights Platform

A conversational AI platform for analyzing healthcare data and generating insights for policy decision-making.

## What Does This Platform Do?

This platform helps government officials and healthcare professionals by:
1. **Analyzing healthcare questions** to understand data requirements
2. **Selecting appropriate analysis frameworks** from specialized prompts
3. **Accessing relevant healthcare datasets** including maternal mortality rates, anemia prevalence, and more
4. **Generating comprehensive insights** with proper formatting and language support

## Features

- **Multi-language Support**: English, Hindi, Marathi, Telugu
- **Multiple Output Formats**: Summary, Detailed Report, Bullet Points
- **Healthcare Data Analysis**: Maternal Mortality Rates, Anemia Prevalence, Iron-Folic Acid consumption
- **Bootstrap-styled Tables**: Beautiful, responsive table formatting for data presentation
- **Conversational Context**: Maintains conversation history for informed responses

## How to Use

### Step 1: Initialize the Platform

1. **Open the platform** by opening `index.html` in your browser
2. **Configure the Analysis Engine** by clicking "Initialize Analysis Engine"
   - Enter your OpenAI-compatible API endpoint
   - Provide your API key
   - Configuration is automatically saved for future use

### Step 2: Set Response Preferences

Configure your preferred settings:
- **Format**: Choose between Summary, Report, or Bullet Points
- **Language**: Select from English, Hindi, Marathi, or Telugu

### Step 3: Ask Questions

Use the sample questions or type your own:
- "Rank the top 5 and bottom 5 districts by MMR"
- "Compare anemia prevalence in Lucknow, Gorakhpur, and Jhansi"
- "Rank the top and bottom districts by Iron-Folic Acid consumption"
- "What are the key strategies to improve maternal health in rural areas?"

## Sample Questions

The platform includes pre-configured sample questions:
- **Data Ranking**: Find top and bottom performing districts
- **Comparative Analysis**: Compare health metrics across districts
- **Strategic Insights**: Get recommendations for healthcare improvements

## Data Sources

The platform analyzes various healthcare datasets including:
- Maternal Mortality Rate (MMR) data
- Anemia prevalence statistics
- Iron-Folic Acid consumption patterns
- District-wise health indicators

## Technical Features

- **Markdown Rendering**: Rich text formatting with Bootstrap-styled tables
- **File Processing**: Supports PDF and Excel file analysis
- **Streaming Responses**: Real-time response generation
- **Responsive Design**: Works on desktop and mobile devices

## Privacy & Security

- LLM configuration stored securely in browser local storage
- Files processed locally in your browser
- Only questions and selected content sent to your chosen LLM provider
- No data permanently stored on external servers

## Troubleshooting

**Platform doesn't respond**
- Ensure the Analysis Engine is properly configured
- Check your internet connection
- Verify your API key is valid and has sufficient credits

**Tables appear as plain text**
- Refresh the browser page to load the latest styling updates
- Ensure Bootstrap CSS is loading properly

**Responses are slow**
- First response may take longer as the system analyzes data files
- Subsequent responses should be faster with conversation context

## Need Help?

If you encounter issues:
1. Check the browser console for error messages
2. Verify your LLM provider configuration
3. Try refreshing the page and reconfiguring the Analysis Engine
4. Ensure all data files are accessible

## Platform Requirements

- Modern web browser with JavaScript enabled
- Internet connection for LLM API access
- Valid API key for OpenAI-compatible provider

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.