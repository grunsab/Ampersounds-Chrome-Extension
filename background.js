const SOCIAL_NETWORK_API_URL = 'https://socialnetwork.social'; // Base URL of the social network

chrome.runtime.onInstalled.addListener(() => {
  console.log('Social Network Ampersound Helper installed.');
  // Perform any first-time setup, like checking login status
  // or setting default configurations if needed.
});

// Listener for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchAmpersoundUrl") {
    const { username, soundname } = request.data;
    fetch(`${SOCIAL_NETWORK_API_URL}/ampersounds/${username}/${soundname}`)
      .then(response => {
        if (!response.ok) {
          return response.json().then(errData => {
            // Ensure a consistent error object structure
            throw { status: response.status, message: errData.message || 'Failed to fetch ampersound data.' };
          });
        }
        return response.json();
      })
      .then(data => {
        if (data.url) {
          sendResponse({ success: true, url: data.url });
        } else {
          sendResponse({ success: false, message: data.message || 'Audio URL not found.' });
        }
      })
      .catch(error => {
        console.error('Error fetching Ampersound URL:', error);
        // Send a structured error back
        const errorMessage = error.message || 'Unknown error fetching ampersound.';
        const errorStatus = error.status || 500; // Default to 500 if no status on error object
        sendResponse({ success: false, message: errorMessage, status: errorStatus });
      });
    return true; // Indicates that the response will be sent asynchronously
  }

  // Example: A way for content script to check login status (optional)
  if (request.action === "checkLoginStatus") {
    chrome.storage.local.get(['authToken', 'username'], (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ loggedIn: false, error: chrome.runtime.lastError.message });
        return;
      }
      if (result.authToken && result.username) {
        sendResponse({ loggedIn: true, username: result.username });
      } else {
        sendResponse({ loggedIn: false });
      }
    });
    return true; // Indicates that the response will be sent asynchronously
  }

  // Add other message handlers here if needed
});

console.log("Background service worker started."); 