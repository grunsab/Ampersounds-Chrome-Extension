const SOCIAL_NETWORK_API_URL = 'https://socialnetwork.social'; // Base URL of the social network

// Removed placeholder allSoundsDatabase

async function searchUserSounds(rawQuery) {
    // rawQuery will be like "&", "&s", "&so", "&user.", "&user.s", etc.
    let queryPart = rawQuery.startsWith('&') ? rawQuery.substring(1) : rawQuery;
    let filterUsername = null;
    let filterSoundnameQuery = queryPart;

    if (queryPart.includes('.')) {
        const parts = queryPart.split('.', 2);
        filterUsername = parts[0];
        filterSoundnameQuery = parts[1] || ""; // If "&user.", query for all sounds by user
    }

    const searchParams = new URLSearchParams();
    if (filterUsername) {
        searchParams.append('username', filterUsername);
    }
    if (filterSoundnameQuery) {
        searchParams.append('q', filterSoundnameQuery);
    }

    // If the query was just "&" or "&user.", and q would be empty, 
    // we might want to fetch all or top sounds, or sounds for that user if username is present.
    // The API design will dictate the best approach here. For now, if q is empty but username is not,
    // it will search for all sounds by that username. If both are effectively empty, it might fetch all sounds.
    // If searchParams is empty, it means rawQuery was just "&"
    if (searchParams.toString() === "" && rawQuery === "&") {
        // Optionally, you could decide to fetch top/popular sounds by default if query is just "&"
        // For now, let's assume an empty query to the endpoint fetches all or popular sounds.
        // Or, return empty if an actual query is required by the API.
        // searchParams.append('popular', 'true'); // Example if API supports this
    }

    const apiUrl = `${SOCIAL_NETWORK_API_URL}/api/v1/ampersounds/search?${searchParams.toString()}`;
    console.log("Searching sounds with URL:", apiUrl); // For debugging

    try {
        // Check if the user is logged in to potentially send auth token if API requires
        // This part depends on how your API handles authentication for search
        // For simplicity, assuming public search or cookie-based auth managed by browser
        const response = await fetch(apiUrl, { credentials: 'include' });

        if (!response.ok) {
            const errorText = await response.text(); // Log the full error text
            console.error(`API error fetching sound suggestions (${response.status}):`, errorText);
            return [];
        }
        const results = await response.json(); // Assuming API returns JSON array of sound objects
        console.log("Raw API results for suggestions:", results); // Added for debugging

        // Assuming API returns objects like: { username: "user", soundname: "name", description: "desc" }
        if (!Array.isArray(results)) {
            console.error("API response for sound suggestions is not an array:", results);
            return [];
        }

        const mappedSuggestions = results.map(sound => ({
            soundTag: `&${sound.user.username}.${sound.name}`, // Adjusted to match API response from app.py for /search
            username: sound.user.username, // Adjusted
            soundname: sound.name,          // Adjusted
            displayText: `${sound.name} by ${sound.user.username}${sound.description ? ` (${sound.description})` : ''}` // Adjusted
        })).slice(0, 10); // Limit to 10 suggestions
        console.log("Mapped suggestions to be sent to content script:", mappedSuggestions); // Added for debugging
        return mappedSuggestions;

    } catch (error) {
        console.error("Error fetching or processing sound suggestions from API:", error);
        return [];
    }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Social Network Ampersound Helper installed.');
  // Perform any first-time setup, like checking login status
  // or setting default configurations if needed.
});

// Listener for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchAmpersoundUrl") {
    const { username, soundname } = request.data;
    fetch(`${SOCIAL_NETWORK_API_URL}/ampersounds/${username}/${soundname}`, { credentials: 'include' })
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

  // New handler for sound suggestions
  if (request.action === "fetchSoundSuggestions") {
    (async () => {
        const rawQuery = request.data.rawQuery;
        if (typeof rawQuery !== 'string') {
            sendResponse({ success: false, message: "Invalid query for suggestions." });
            return;
        }
        try {
            const suggestions = await searchUserSounds(rawQuery);
            sendResponse({ success: true, suggestions: suggestions });
        } catch (error) {
            console.error("Error fetching sound suggestions:", error);
            sendResponse({ success: false, message: "Error processing suggestion request." });
        }
    })();
    return true; // Required to keep message channel open for async response
  }

  // Add other message handlers here if needed
});

console.log("Background service worker started."); 