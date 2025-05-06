console.log("Ampersound Content Script Initializing");

let activeAudioGlobal = null;
const ampersandPatternGlobal = /&([a-zA-Z0-9_][a-zA-Z0-9_-]*)\.([a-zA-Z0-9_][a-zA-Z0-9_-]+)|&([a-zA-Z0-9_][a-zA-Z0-9_-]+)/g;
let currentLoggedInUsernameGlobal = null;
let processingDebounceTimer = null;

/**
 * Handles the mouseover event on an ampersound span.
 * Attempts to resolve the username if needed (for &soundname format).
 * Fetches the audio URL from the background script and plays the sound.
 * Manages the currently active audio element.
 */
async function handleAmpersoundHover(event) {
    const target = event.currentTarget;
    const originalText = target.dataset.originaltext;
    let username = target.dataset.username;
    let soundname = target.dataset.soundname;

    // Attempt to resolve username for &soundname tags using cached or stored login state
    if ((!username || username === 'undefined') && soundname && originalText.startsWith('&') && !originalText.includes('.')) {
        if (currentLoggedInUsernameGlobal) {
            username = currentLoggedInUsernameGlobal;
        } else {
            try {
                // Check storage if not cached locally in this script execution context
                const storedUser = await chrome.storage.local.get(['username']);
                if (storedUser.username) {
                    username = storedUser.username;
                    currentLoggedInUsernameGlobal = username; // Cache for subsequent hovers
                } else {
                    target.title = "Login required for context";
                    return; 
                }
            } catch (e) {
                console.error("Error getting username from storage:", e);
                target.title = "Error resolving context";
                return;
            }
        }
    }

    // If username is still unresolved or soundname is missing, abort
    if (!username || username === 'undefined' || !soundname) {
        console.warn("Cannot fetch Ampersound: Missing username or soundname.", { username, soundname });
        target.title = "Error: Missing sound data";
        return;
    }
    
    // Stop any existing audio playback immediately
    if (activeAudioGlobal) {
        activeAudioGlobal.pause();
        try { activeAudioGlobal.remove(); } catch(e) {} 
        activeAudioGlobal = null;
    }

    target.title = `Loading ${originalText}...`;

    try {
        // Request audio URL from background script
        const response = await chrome.runtime.sendMessage({
            action: "fetchAmpersoundUrl",
            data: { username, soundname }
        });

        // If fetch was successful and contained a URL
        if (response && response.success && response.url) {
             // Double-check: Only play if the mouse is *still* hovering over the target
            if (!target.matches(':hover')) {
                target.title = `Play ${originalText} (on hover)`; // Reset title
                return; // User moved away before fetch completed
            }

            // Create and play the audio
            activeAudioGlobal = new Audio(response.url);
            target.title = `Playing ${originalText}`;
            activeAudioGlobal.play().catch(playError => {
                console.error("Error playing audio:", playError);
                target.title = `Error playing ${originalText}: ${playError.message}`;
                if (activeAudioGlobal) { try { activeAudioGlobal.remove(); } catch(e) {} activeAudioGlobal = null; }
            });

            // Cleanup when audio finishes
            activeAudioGlobal.onended = () => {
                 if (!target.matches(':hover')) { // Don't reset title if still hovering (might retrigger)
                     target.title = target.classList.contains('ampersound-tag-ext-contextual') 
                                    ? `Play ${originalText} (context needed, on hover)`
                                    : `Play ${originalText} (on hover)`;
                 }
                if (activeAudioGlobal) { try { activeAudioGlobal.remove(); } catch(e) {} activeAudioGlobal = null; }
            };
            // Handle audio loading errors
            activeAudioGlobal.onerror = (e) => {
                console.error("Audio element error:", e);
                target.title = `Error loading audio for ${originalText}`;
                 if (activeAudioGlobal) { try { activeAudioGlobal.remove(); } catch(e) {} activeAudioGlobal = null; }
            };
        } else {
            // Handle errors reported by the background script (e.g., sound not found, permission denied)
            const errorMessage = response ? response.message : 'Failed to get audio URL from background.';
            console.error("Failed to get Ampersound URL:", errorMessage, "Response:", response);
            target.title = `Error: ${errorMessage}`;
        }
    } catch (err) {
        // Handle errors during message passing or other unexpected issues
        console.error("Error messaging background script:", err);
        target.title = `Client-side error: ${err.message}`;
        if (activeAudioGlobal) { activeAudioGlobal.pause(); try { activeAudioGlobal.remove(); } catch(e) {} activeAudioGlobal = null; }
    }
}

/**
 * Handles the mouseout event on an ampersound span.
 * Stops any currently playing audio associated with the extension.
 * Resets the span's title attribute.
 */
function handleAmpersoundMouseOut(event) {
    const target = event.currentTarget;
    const originalText = target.dataset.originaltext;
    
    if (activeAudioGlobal) {
        activeAudioGlobal.pause();
        activeAudioGlobal.removeAttribute('src'); 
        activeAudioGlobal.load(); // Ensure playback/loading is aborted
        try { activeAudioGlobal.remove(); } catch(e) { /* ignore if already removed */ }
        activeAudioGlobal = null;
    }
    
    // Reset title, preserving original hint about context if needed
    if (!target.title.startsWith("Error:")) { 
        const baseTitle = `Play ${originalText} (on hover)`;
        const contextualSuffix = target.classList.contains('ampersound-tag-ext-contextual') ? " (context needed, on hover)" : " (on hover)";
        target.title = `Play ${originalText}${contextualSuffix}`;
    }
}

/**
 * Processes a text node, searching for ampersound patterns.
 * If found, replaces the text with text nodes and styled <span> elements.
 * Attaches appropriate event listeners (mouseover, mouseout) to the spans.
 * Sets data attributes needed by the event handlers.
 * @param {Node} node The text node to process.
 * @param {string|null} loggedInUser The currently logged-in user's username, or null.
 */
function processTextNode(node, loggedInUser) {
    let match;
    let lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let found = false;
    ampersandPatternGlobal.lastIndex = 0; // Reset regex state for each node

    // Iterate through all matches in the text node
    while ((match = ampersandPatternGlobal.exec(node.nodeValue)) !== null) {
        found = true;
        const originalTagText = match[0];          // Full matched text (e.g., "&user.sound")
        const specifiedUsernameInTag = match[1];   // Captured username (group 1)
        const soundNameIfUserSpecified = match[2]; // Captured soundname (group 2)
        const singleSoundNameFromTag = match[3];   // Captured soundname (group 3, if no user specified)

        let usernameForDataset, soundNameToPlay;

        // Determine username and soundname based on which regex groups matched
        if (specifiedUsernameInTag && soundNameIfUserSpecified) {
            // Format &username.soundname
            usernameForDataset = specifiedUsernameInTag;
            soundNameToPlay = soundNameIfUserSpecified;
        } else if (singleSoundNameFromTag) {
            // Format &soundname
            soundNameToPlay = singleSoundNameFromTag;
            // Use logged-in user if available, otherwise mark as 'undefined' for hover handler to resolve
            usernameForDataset = loggedInUser || 'undefined'; 
        }

        // If we successfully identified a soundname to potentially play
        if (soundNameToPlay) {
            // Append text before the match
            if (lastIndex < match.index) {
                fragment.appendChild(document.createTextNode(node.nodeValue.substring(lastIndex, match.index)));
            }
            
            // Create the interactive span
            const span = document.createElement('span');
            span.className = 'ampersound-tag-ext';
            span.textContent = originalTagText;
            span.title = `Play ${originalTagText} (on hover)`; 
            // Store data needed by hover/mouseout handlers
            span.dataset.username = usernameForDataset;
            span.dataset.soundname = soundNameToPlay;
            span.dataset.originaltext = originalTagText;
            
            // Attach hover/mouseout listeners
            span.addEventListener('mouseover', handleAmpersoundHover);
            span.addEventListener('mouseout', handleAmpersoundMouseOut);

            // Add specific class and update title if username context might be needed
            if (usernameForDataset === 'undefined' && singleSoundNameFromTag) {
                span.classList.add('ampersound-tag-ext-contextual');
                span.title = `Play ${originalTagText} (context needed, on hover)`;
            }

            fragment.appendChild(span);
            lastIndex = ampersandPatternGlobal.lastIndex; // Update position for next match
        }
    }

    // If any matches were found, replace the original text node with the fragment
    if (found && node.parentNode) {
        // Append any remaining text after the last match
        if (lastIndex < node.nodeValue.length) {
            fragment.appendChild(document.createTextNode(node.nodeValue.substring(lastIndex)));
        }
        node.parentNode.replaceChild(fragment, node);
    }
}

/**
 * Recursively walks the DOM starting from `node`.
 * Calls `func` on discovered text nodes, avoiding scripts, styles, inputs, and contentEditable areas.
 * @param {Node} node The starting node.
 * @param {Function} func The function to call on text nodes.
 * @param {string|null} loggedInUser The current username or null.
 */
function walkDOM(node, func, loggedInUser) {
    if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentNode;
        // Ensure parent exists and is not an element we should ignore
        if (!parent) return;
        const parentTag = parent.tagName ? parent.tagName.toLowerCase() : '';
        if (parentTag !== 'script' && parentTag !== 'style' && parentTag !== 'textarea' &&
            !parent.isContentEditable &&
            !parent.classList.contains('ampersound-tag-ext')) { // Avoid processing our own spans
            func(node, loggedInUser);
        }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
        // Skip entire subtrees of ignored elements
        const tagName = node.tagName.toLowerCase();
        if (node.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'script' || tagName === 'style') {
            return;
        }
        // Process child nodes
        const children = Array.from(node.childNodes);
        for (let i = 0; i < children.length; i++) {
            walkDOM(children[i], func, loggedInUser);
        }
    }
}

/**
 * Checks login status and initiates the initial DOM processing.
 */
async function initAndProcessDOM() {
    // console.log("Ampersound DOM Processing Triggered...");
    try {
        // Check login status via background script
        const status = await chrome.runtime.sendMessage({ action: "checkLoginStatus" });
        if (status && status.loggedIn) {
            currentLoggedInUsernameGlobal = status.username;
        } else {
            currentLoggedInUsernameGlobal = null;
        }
    } catch (e) {
        // Background script might not be ready on initial load, proceed without username
        currentLoggedInUsernameGlobal = null;
        // console.warn("Error checking login status in content script (background might not be ready):", e.message);
    }
    // Process the initial DOM
    walkDOM(document.body, processTextNode, currentLoggedInUsernameGlobal);
}

/**
 * Creates a debounced version of a function.
 */
function debounceProcess(func, delay) {
    return function(...args) {
        clearTimeout(processingDebounceTimer);
        processingDebounceTimer = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

// Create a debounced version of the DOM processor for the MutationObserver
const debouncedProcessDOM = debounceProcess(initAndProcessDOM, 300);

/**
 * Sets up a MutationObserver to watch for changes in the DOM (e.g., dynamically loaded content)
 * and trigger a debounced reprocessing of the DOM to find new ampersound tags.
 */
function initializeMutationObserver() {
    const observer = new MutationObserver((mutationsList) => {
        let needsReprocessing = false;
        for (const mutation of mutationsList) {
            // Check for added nodes
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (const newNode of mutation.addedNodes) {
                    // Ignore mutations caused by our own span injection
                    if (newNode.nodeType === Node.ELEMENT_NODE && newNode.classList && newNode.classList.contains('ampersound-tag-ext')) {
                        continue;
                    }
                    // If an element or text node containing '&' was added, flag for reprocessing
                    if (newNode.nodeType === Node.ELEMENT_NODE || 
                        (newNode.nodeType === Node.TEXT_NODE && newNode.nodeValue && newNode.nodeValue.includes('&'))) {
                        needsReprocessing = true;
                        break;
                    }
                }
            }
            // Check if text content changed in an existing node
            if (mutation.type === 'characterData') {
                const parentNode = mutation.target.parentNode;
                // Check if the parent is valid and the text contains '&'
                if (parentNode && (!parentNode.classList || !parentNode.classList.contains('ampersound-tag-ext')) && 
                    mutation.target.nodeValue && mutation.target.nodeValue.includes('&')) {
                    needsReprocessing = true;
                }
            }
            if (needsReprocessing) break; // No need to check further mutations if already flagged
        }
        
        // If any mutation indicated a potential new ampersound, run the debounced processor
        if (needsReprocessing) {
            debouncedProcessDOM();
        }
    });

    // Observe the entire body for additions, removals, and text changes
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    console.log("MutationObserver initialized for Ampersounds.");
}

// --- Initial Execution --- 
if (document.readyState === 'loading') {
    // Process DOM after it's loaded, then start observing
    document.addEventListener('DOMContentLoaded', () => {
        initAndProcessDOM();
        initializeMutationObserver();
    });
} else {
    // DOM already loaded, process and start observing immediately
    initAndProcessDOM();
    initializeMutationObserver();
}