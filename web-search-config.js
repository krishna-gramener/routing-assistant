// Web Search Configuration
// This file contains configuration options for web search integration

const WEB_SEARCH_CONFIG = {
  // Choose your preferred search API
  provider: 'google', // Options: 'google', 'bing', 'serpapi', 'custom'
  
  // API Configuration
  api: {
    // Google Custom Search API
    google: {
      apiKey: 'AIzaSyCygIqZD5z6LdCgZoooeE8_YXrXwt8Zhkk',
      searchEngineId: '2215ab40a44664839',
      baseUrl: 'https://www.googleapis.com/customsearch/v1'
    },
  },
  // Search parameters
  searchParams: {
    numResults: 5, // Number of results to return
    safeSearch: 'moderate', // Safe search level
    language: 'en', // Search language
    region: 'in' // Search region (India)
  },
  
  // Healthcare-specific search filters
  healthcareFilters: {
    preferredDomains: [
      'who.int',
      'unicef.org',
      'mohfw.gov.in',
      'nhs.uk',
      'cdc.gov',
      'nih.gov',
      'pubmed.ncbi.nlm.nih.gov',
      'bmj.com',
      'thelancet.com',
      'nejm.org'
    ],
    excludeDomains: [
      'wikipedia.org',
      'reddit.com',
      'facebook.com',
      'twitter.com'
    ]
  }
};

// Export for use in main script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WEB_SEARCH_CONFIG;
} else {
  window.WEB_SEARCH_CONFIG = WEB_SEARCH_CONFIG;
}
