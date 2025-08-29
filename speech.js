// Modern Speech Recognition and Text-to-Speech Module
class SpeechManager {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.speechSynthesis = window.speechSynthesis;
    this.currentUtterance = null;
    this.isSpeaking = false;
    this.isPaused = false;
    this.voices = [];
    
    this.initializeSpeechRecognition();
    this.loadVoices();
  }

  // Load available voices and set up voice change handler
  loadVoices() {
    const updateVoices = () => {
      this.voices = this.speechSynthesis.getVoices();
      console.log('Available voices:', this.voices.length);
    };

    updateVoices();
    
    // Voices might not be loaded immediately
    if (this.voices.length === 0) {
      this.speechSynthesis.addEventListener('voiceschanged', updateVoices);
    }
  }

  // Initialize Speech Recognition
  initializeSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      console.warn('Speech Recognition not supported');
      const micBtn = document.getElementById('mic-btn');
      if (micBtn) micBtn.style.display = 'none';
      return false;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';
    
    this.recognition.onstart = () => this.handleRecognitionStart();
    this.recognition.onresult = (event) => this.handleRecognitionResult(event);
    this.recognition.onend = () => this.handleRecognitionEnd();
    this.recognition.onerror = (event) => this.handleRecognitionError(event);
    
    return true;
  }

  handleRecognitionStart() {
    this.isListening = true;
    const micBtn = document.getElementById('mic-btn');
    const micIcon = document.getElementById('mic-icon');
    
    if (micBtn && micIcon) {
      micBtn.classList.remove('btn-outline-primary');
      micBtn.classList.add('btn-danger');
      micIcon.classList.remove('bi-mic');
      micIcon.classList.add('bi-mic-fill');
      micBtn.title = 'Listening... Click to stop';
    }
  }

  handleRecognitionResult(event) {
    const transcript = event.results[0][0].transcript;
    const userQuestionInput = document.getElementById('user-question');
    const sendButton = document.getElementById('send-btn');
    
    if (userQuestionInput) {
      userQuestionInput.value = transcript;
      
      // Enable controls if disabled
      if (userQuestionInput.disabled) userQuestionInput.disabled = false;
      if (sendButton && sendButton.disabled) sendButton.disabled = false;
      
      // Auto-submit after a short delay
      setTimeout(() => {
        if (sendButton) sendButton.click();
      }, 500);
    }
  }

  handleRecognitionEnd() {
    this.isListening = false;
    this.resetMicButton();
  }

  handleRecognitionError(event) {
    console.error('Speech recognition error:', event.error);
    this.isListening = false;
    this.resetMicButton();
  }

  resetMicButton() {
    const micBtn = document.getElementById('mic-btn');
    const micIcon = document.getElementById('mic-icon');
    
    if (micBtn && micIcon) {
      micBtn.classList.remove('btn-danger');
      micBtn.classList.add('btn-outline-primary');
      micIcon.classList.remove('bi-mic-fill');
      micIcon.classList.add('bi-mic');
      micBtn.title = 'Click to speak';
    }
  }

  // Toggle speech recognition
  toggleRecognition() {
    if (!this.recognition) return;
    
    if (this.isListening) {
      this.recognition.stop();
    } else {
      try {
        this.recognition.start();
      } catch (error) {
        console.error('Failed to start recognition:', error);
      }
    }
  }

  // Text-to-Speech with improved error handling
  speakText(text) {
    if (!text || !this.speechSynthesis) {
      console.warn('No text provided or speech synthesis not available');
      return;
    }
    
    // Stop any current speech
    this.stopSpeaking();
    
    try {
      this.currentUtterance = new SpeechSynthesisUtterance(text);
      
      // Configure utterance
      this.currentUtterance.rate = 0.9;
      this.currentUtterance.pitch = 1;
      this.currentUtterance.volume = 1;
      
      // Try to use a high-quality voice if available
      const preferredVoice = this.voices.find(voice => 
        voice.lang.startsWith('en') && voice.localService
      ) || this.voices.find(voice => voice.lang.startsWith('en'));
      
      if (preferredVoice) {
        this.currentUtterance.voice = preferredVoice;
      }
      
      this.currentUtterance.onstart = () => {
        this.isSpeaking = true;
        this.isPaused = false;
        this.updateSpeakControls();
        console.log('Speech started');
      };
      
      this.currentUtterance.onend = () => {
        this.isSpeaking = false;
        this.isPaused = false;
        this.currentUtterance = null;
        this.updateSpeakControls();
        console.log('Speech ended');
      };
      
      this.currentUtterance.onerror = (event) => {
        console.error('Speech synthesis error:', event.error);
        this.handleSpeechError(event.error);
      };
      
      // Add to queue
      this.speechSynthesis.speak(this.currentUtterance);
      
    } catch (error) {
      console.error('Failed to create speech utterance:', error);
      this.handleSpeechError('synthesis-failed');
    }
  }

  handleSpeechError(error) {
    this.isSpeaking = false;
    this.isPaused = false;
    this.currentUtterance = null;
    this.updateSpeakControls();
    
    // Show user-friendly error message
    const errorMsg = this.getSpeechErrorMessage(error);
    console.warn('Speech error:', errorMsg);
    
    // Optionally show a toast or notification to the user
    this.showSpeechErrorNotification(errorMsg);
  }

  getSpeechErrorMessage(error) {
    switch (error) {
      case 'network':
        return 'Network connection required for speech synthesis';
      case 'synthesis-unavailable':
        return 'Speech synthesis not available on this device';
      case 'synthesis-failed':
        return 'Speech synthesis failed. Please try again';
      case 'audio-capture':
        return 'Audio capture failed';
      case 'audio-busy':
        return 'Audio system is busy';
      default:
        return 'Speech synthesis error occurred';
    }
  }

  showSpeechErrorNotification(message) {
    // Create a simple toast notification
    const toast = document.createElement('div');
    toast.className = 'position-fixed top-0 end-0 p-3';
    toast.style.zIndex = '9999';
    toast.innerHTML = `
      <div class="toast show" role="alert">
        <div class="toast-header">
          <strong class="me-auto text-warning">Speech Notice</strong>
          <button type="button" class="btn-close" data-bs-dismiss="toast"></button>
        </div>
        <div class="toast-body">${message}</div>
      </div>
    `;
    
    document.body.appendChild(toast);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 5000);
  }
  
  pauseSpeaking() {
    if (this.speechSynthesis && this.isSpeaking && !this.isPaused) {
      try {
        this.speechSynthesis.pause();
        this.isPaused = true;
        this.updateSpeakControls();
      } catch (error) {
        console.error('Failed to pause speech:', error);
      }
    }
  }
  
  resumeSpeaking() {
    if (this.speechSynthesis && this.isPaused) {
      try {
        this.speechSynthesis.resume();
        this.isPaused = false;
        this.updateSpeakControls();
      } catch (error) {
        console.error('Failed to resume speech:', error);
      }
    }
  }
  
  stopSpeaking() {
    if (this.speechSynthesis) {
      try {
        this.speechSynthesis.cancel();
        this.isSpeaking = false;
        this.isPaused = false;
        this.currentUtterance = null;
        this.updateSpeakControls();
      } catch (error) {
        console.error('Failed to stop speech:', error);
      }
    }
  }
  
  updateSpeakControls() {
    const speakBtn = document.getElementById('speak-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const stopBtn = document.getElementById('stop-btn');
    const speakIcon = document.getElementById('speak-icon');
    
    if (!speakBtn || !pauseBtn || !stopBtn || !speakIcon) return;
    
    if (this.isSpeaking && !this.isPaused) {
      speakBtn.classList.add('d-none');
      pauseBtn.classList.remove('d-none');
      stopBtn.classList.remove('d-none');
    } else if (this.isSpeaking && this.isPaused) {
      speakBtn.classList.remove('d-none');
      pauseBtn.classList.add('d-none');
      stopBtn.classList.remove('d-none');
      speakIcon.className = 'bi bi-play';
      speakBtn.title = 'Resume reading';
    } else {
      speakBtn.classList.remove('d-none');
      pauseBtn.classList.add('d-none');
      stopBtn.classList.add('d-none');
      speakIcon.className = 'bi bi-volume-up';
      speakBtn.title = 'Read aloud';
    }
  }
  
  // Get text content from analysis results
  getAnalysisText() {
    const chatBody = document.querySelector('#chat-messages .card-body');
    if (!chatBody) return '';
    
    // Get only assistant messages (analysis results), skip user queries
    const assistantMessages = chatBody.querySelectorAll('.alert:not(.alert-primary)');
    
    if (assistantMessages.length === 0) {
      return '';
    }
    
    // Extract text from assistant messages only
    let analysisText = '';
    assistantMessages.forEach(message => {
      const messageContent = message.querySelector('.message-content');
      if (messageContent) {
        const text = messageContent.textContent || messageContent.innerText || '';
        analysisText += text.trim() + '\n\n';
      }
    });
    
    return analysisText.trim();
  }

  // Show speech controls when analysis results are available
  showSpeakControls() {
    const chatHeader = document.getElementById('chat-header');
    if (chatHeader) {
      chatHeader.classList.remove('d-none');
    }
  }

  // Set up event listeners for speech controls
  initializeSpeechControls() {
    const speakBtn = document.getElementById('speak-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const stopBtn = document.getElementById('stop-btn');
    const micBtn = document.getElementById('mic-btn');

    if (speakBtn) {
      speakBtn.addEventListener('click', () => {
        if (this.isPaused) {
          this.resumeSpeaking();
        } else {
          const text = this.getAnalysisText();
          if (text) {
            this.speakText(text);
          } else {
            console.warn('No analysis text found to speak');
          }
        }
      });
    }

    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => this.pauseSpeaking());
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', () => this.stopSpeaking());
    }

    if (micBtn) {
      micBtn.addEventListener('click', () => this.toggleRecognition());
    }
  }

  // Observe chat changes to show speech controls
  observeChatChanges() {
    const chatBody = document.querySelector('#chat-messages .card-body');
    if (!chatBody) return;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Check if assistant message was added
          const addedNodes = Array.from(mutation.addedNodes);
          const hasAssistantMessage = addedNodes.some(node => 
            node.nodeType === Node.ELEMENT_NODE && 
            node.classList && 
            node.classList.contains('alert') && 
            !node.classList.contains('alert-primary')
          );
          
          if (hasAssistantMessage) {
            setTimeout(() => {
              this.showSpeakControls();
            }, 100);
          }
        }
      });
    });

    observer.observe(chatBody, {
      childList: true,
      subtree: true
    });
  }
}

// Export for use in other modules
export { SpeechManager };
