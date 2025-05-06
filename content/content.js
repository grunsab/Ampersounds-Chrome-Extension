console.log("Ampersound Content Script Initializing");

let activeAudioGlobal = null;
const ampersandPatternGlobal = /&([a-zA-Z0-9_][a-zA-Z0-9_-]*)\.([a-zA-Z0-9_][a-zA-Z0-9_-]+)|&([a-zA-Z0-9_][a-zA-Z0-9_-]+)/g;
let currentLoggedInUsernameGlobal = null;
let processingDebounceTimer = null;

// --- Autocomplete Functionality ---

let autocompleteUIDiv = null;
let currentActiveInputForAutocomplete = null;
let autocompleteDebounceTimer = null;
const AUTOCOMPLETE_DEBOUNCE_DELAY = 300; // ms
let activeAudioGlobalForAutocomplete = null; // Separate audio object for autocomplete previews

const EXCLUDED_AUTOCOMPLETE_HOSTNAMES_MAIN = [
    'google.com',    // Covers www.google.com, google.co.uk, etc.
    'bing.com',
    'duckduckgo.com',
    'baidu.com',
    'yahoo.com',     // Specifically for search, might need refinement if Yahoo mail etc. is desired
    'yandex.com',    // Covers yandex.ru too
    'ecosia.org',
    'ask.com'
];

const ALLOWED_EMAIL_HOSTNAMES_FOR_AUTOCOMPLETE = [
    'mail.google.com',
    'outlook.live.com',
    'outlook.office.com',
    'mail.yahoo.com',
    'mail.protonmail.com',
    'app.proton.me', // For Proton web client
    'mail.zoho.com',
    'mail.yandex.com' // Yandex Mail
];

// Helper to check if the current hostname is in the exclusion list or a subdomain of an excluded entry
function isHostnameExcludedForAutocomplete(hostname, exclusionList) {
    // First, check if the hostname is an explicitly allowed email client
    if (ALLOWED_EMAIL_HOSTNAMES_FOR_AUTOCOMPLETE.includes(hostname)) {
        // console.log(`Ampersound Autocomplete explicitly ALLOWED on: ${hostname}`);
        return false; // This is an allowed email client, so NOT excluded.
    }
    // If not an explicitly allowed email client, then check against the general exclusion list for search engines
    return exclusionList.some(excludedSite => {
        // Check if hostname is exactly the excluded site or a subdomain of it
        // e.g., "google.com" should match "www.google.com" and "news.google.com"
        return hostname === excludedSite || hostname.endsWith('.' + excludedSite);
    });
}

function injectAutocompleteStyles() {
    const styleId = 'ampersound-autocomplete-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .ampersound-autocomplete-ui {
            position: absolute;
            border: 1px solid #ccc;
            background-color: white;
            z-index: 2147483647; /* Max z-index */
            display: none;
            max-height: 200px;
            overflow-y: auto;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            font-family: sans-serif; /* Ensure a common font */
            font-size: 14px; /* Base font size */
        }
        .ampersound-autocomplete-ui ul {
            list-style-type: none;
            margin: 0;
            padding: 0;
        }
        .ampersound-autocomplete-ui li {
            padding: 8px 12px;
            cursor: pointer;
            border-bottom: 1px solid #eee;
            white-space: nowrap; /* Prevent ugly wrapping */
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ampersound-autocomplete-ui li:last-child {
            border-bottom: none;
        }
        .ampersound-autocomplete-ui li:hover { /* General hover */
            background-color: #f0f0f0;
        }
        .ampersound-autocomplete-ui li.active { /* Keyboard navigation active */
            background-color: #d0e0f0;
            color: #333;
        }
    `;
    document.head.appendChild(style);
}


function createAutocompleteUI() {
    if (autocompleteUIDiv) return;

    autocompleteUIDiv = document.createElement('div');
    autocompleteUIDiv.className = 'ampersound-autocomplete-ui';
    // Styles are mostly handled by injected CSS, but some basics here if needed
    document.body.appendChild(autocompleteUIDiv);
}

function positionAutocompleteUI(inputElement) {
    if (!autocompleteUIDiv) createAutocompleteUI();

    const rect = inputElement.getBoundingClientRect();
    autocompleteUIDiv.style.left = `${rect.left + window.scrollX}px`;
    autocompleteUIDiv.style.top = `${rect.bottom + window.scrollY + 2}px`; // +2 for a small gap
    autocompleteUIDiv.style.minWidth = `${Math.max(150, rect.width)}px`; // Ensure a minimum width
    autocompleteUIDiv.style.maxWidth = `${Math.max(300, rect.width)}px`;


    // Adjust if too close to bottom of viewport
    if (rect.bottom + 200 > window.innerHeight) { // Assuming max height of 200
        autocompleteUIDiv.style.top = `${rect.top + window.scrollY - autocompleteUIDiv.offsetHeight - 2}px`;
    }


    showAutocompleteUI();
}

function showAutocompleteUI() {
    if (autocompleteUIDiv) {
        autocompleteUIDiv.style.display = 'block';
    }
}

function hideAutocompleteUI() {
    if (autocompleteUIDiv) {
        autocompleteUIDiv.style.display = 'none';
        autocompleteUIDiv.innerHTML = ''; // Clear contents
    }
    currentActiveInputForAutocomplete = null;
    if (activeAudioGlobalForAutocomplete) { // Stop preview audio when hiding
        activeAudioGlobalForAutocomplete.pause();
        try { activeAudioGlobalForAutocomplete.remove(); } catch(e) {}
        activeAudioGlobalForAutocomplete = null;
    }
}

async function handleAutocompleteItemHover(event) {
    const listItem = event.currentTarget;
    const username = listItem.dataset.username;
    const soundname = listItem.dataset.soundname;
    // const originalText = listItem.dataset.originaltext;

    if (!username || !soundname) {
        return;
    }

    if (activeAudioGlobalForAutocomplete) {
        activeAudioGlobalForAutocomplete.pause();
        try { activeAudioGlobalForAutocomplete.remove(); } catch(e) {}
        activeAudioGlobalForAutocomplete = null;
    }

    try {
        const response = await chrome.runtime.sendMessage({
            action: "fetchAmpersoundUrl",
            data: { username, soundname }
        });

        if (response && response.success && response.url) {
            if (!listItem.matches(':hover') && !listItem.classList.contains('active')) return;

            activeAudioGlobalForAutocomplete = new Audio(response.url);
            activeAudioGlobalForAutocomplete.play().catch(playError => {
                console.error("Error playing autocomplete preview:", playError);
                if (activeAudioGlobalForAutocomplete) { try { activeAudioGlobalForAutocomplete.remove(); } catch(e) {} activeAudioGlobalForAutocomplete = null; }
            });

            activeAudioGlobalForAutocomplete.onended = () => {
                if (activeAudioGlobalForAutocomplete) { try { activeAudioGlobalForAutocomplete.remove(); } catch(e) {} activeAudioGlobalForAutocomplete = null; }
            };
            activeAudioGlobalForAutocomplete.onerror = (e) => {
                console.error("Audio element error (autocomplete preview):", e);
                if (activeAudioGlobalForAutocomplete) { try { activeAudioGlobalForAutocomplete.remove(); } catch(e) {} activeAudioGlobalForAutocomplete = null; }
            };
        } else {
            // console.error("Failed to get URL for autocomplete preview:", response ? response.message : "No response");
        }
    } catch (err) {
        console.error("Error in autocomplete preview:", err);
        if (activeAudioGlobalForAutocomplete) { activeAudioGlobalForAutocomplete.pause(); try { activeAudioGlobalForAutocomplete.remove(); } catch(e) {} activeAudioGlobalForAutocomplete = null; }
    }
}

function handleAutocompleteItemMouseOut() {
    if (activeAudioGlobalForAutocomplete) {
        activeAudioGlobalForAutocomplete.pause();
        // No need to remove src or load, just nullify for next hover
        try { activeAudioGlobalForAutocomplete.remove(); } catch(e) {}
        activeAudioGlobalForAutocomplete = null;
    }
}

function updateAutocompleteSuggestions(suggestions, inputElement, query) {
    console.log('updateAutocompleteSuggestions called with input:', inputElement, 'query:', query); // Added for debugging
    if (!autocompleteUIDiv) createAutocompleteUI();

    autocompleteUIDiv.innerHTML = '';
    console.log('Received suggestions in updateAutocompleteSuggestions:', suggestions); // Added for debugging

    if (!suggestions || suggestions.length === 0) {
        hideAutocompleteUI();
        return;
    }

    const ul = document.createElement('ul');
    suggestions.forEach(suggestion => {
        // Expected suggestion: { soundTag: "&user.sound", username: "user", soundname: "sound", displayText: "user.sound (description)" }
        const li = document.createElement('li');
        li.textContent = suggestion.displayText || suggestion.soundTag;
        li.title = suggestion.soundTag; // Show full tag on hover of list item

        li.dataset.username = suggestion.username;
        li.dataset.soundname = suggestion.soundname;
        li.dataset.originaltext = suggestion.soundTag;

        li.addEventListener('mousedown', (e) => {
            console.log('[Ampersound Debug] Autocomplete LI mousedown event (capture phase). Preventing default.');
            e.preventDefault(); // Prevent focus shift from input
        }, true); // Use capture for mousedown as well

        li.addEventListener('mouseenter', (e) => { // mouseenter is often better than mouseover for this
            // Highlight on hover visually
            const currentlyActive = ul.querySelector('li.active');
            if (currentlyActive) currentlyActive.classList.remove('active');
            e.currentTarget.classList.add('active');
            handleAutocompleteItemHover(e);
        });
        li.addEventListener('mouseleave', handleAutocompleteItemMouseOut);
        li.addEventListener('click', () => {
            console.log(`[Ampersound Debug] Autocomplete LI clicked (capture phase listener). Suggestion: ${suggestion.soundTag}, Query: ${query}, Input Element:`, inputElement);
            handleAutocompleteSelection(suggestion.soundTag, inputElement, query);
        }, true);
        ul.appendChild(li);
    });

    autocompleteUIDiv.appendChild(ul);
    positionAutocompleteUI(inputElement); // Re-position in case content made it grow
    showAutocompleteUI();
    if (ul.firstChild) { // Auto-highlight first item for keyboard nav
        ul.firstChild.classList.add('active');
    }
}


async function fetchSoundSuggestionsFromBackground(query) {
    try {
        const response = await chrome.runtime.sendMessage({
            action: "fetchSoundSuggestions",
            data: { rawQuery: query }
        });

        if (response && response.success) {
            return response.suggestions;
        } else {
            console.warn("No suggestions received or error:", response ? response.message : "No response");
            return [];
        }
    } catch (error) {
        console.error("Error sending message for sound suggestions:", error.message);
        return [];
    }
}

function handleAutocompleteSelection(soundTag, inputElement, originalQuery) {
    console.log('[Ampersound Debug] handleAutocompleteSelection called with:');
    console.log('[Ampersound Debug]   soundTag:', soundTag);
    console.log('[Ampersound Debug]   inputElement:', inputElement);
    console.log('[Ampersound Debug]   originalQuery (query that fetched suggestions):', originalQuery);
    console.log('[Ampersound Debug]   inputElement.isContentEditable:', inputElement.isContentEditable);
    console.log('[Ampersound Debug]   inputElement.tagName:', inputElement.tagName, 'inputElement.type:', inputElement.type);

    let textToInsert = soundTag + " "; // Add a space after insertion
    const ampersandPrefixRegex = /&([a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]*)?)?$/;

    if (inputElement.isContentEditable) {
        console.log('[Ampersound Debug] Handling contentEditable element.');
        const selection = window.getSelection();
        if (!selection.rangeCount) {
            console.warn('[Ampersound Debug] No selection range found for contentEditable.');
            hideAutocompleteUI();
            return;
        }
        let range = selection.getRangeAt(0);
        console.log('[Ampersound Debug]   Initial range:', range);

        if (!inputElement.contains(range.startContainer)) {
            console.log('[Ampersound Debug]   Selection not in target input. Attempting to focus and set cursor to end.');
            inputElement.focus();
            range = document.createRange();
            range.selectNodeContents(inputElement);
            range.collapse(false); // To the end
            selection.removeAllRanges();
            selection.addRange(range);
            console.log('[Ampersound Debug]   New range after focus:', range);
        }

        const node = range.startContainer;
        const offset = range.startOffset; // Current cursor position within the node
        console.log('[Ampersound Debug]   Node:', node, 'Offset:', offset, 'Node type:', node.nodeType);

        if (node.nodeType === Node.TEXT_NODE) {
            const textContent = node.nodeValue; // Full text of the current text node
            const textBeforeCursorInNode = textContent.substring(0, offset); // Text in node up to cursor
            console.log('[Ampersound Debug]   Text node content:', textContent);
            console.log('[Ampersound Debug]   Text before cursor in node:', textBeforeCursorInNode);

            const currentTokenMatch = textBeforeCursorInNode.match(ampersandPrefixRegex);

            if (currentTokenMatch) {
                const prefixToReplace = currentTokenMatch[0];
                const startIndexInNode = offset - prefixToReplace.length;
                console.log('[Ampersound Debug]   Found current token to replace:', prefixToReplace, 'at index in node:', startIndexInNode);

                if (startIndexInNode >= 0) {
                    // Revert to direct node.nodeValue manipulation
                    node.nodeValue = textContent.substring(0, startIndexInNode) +
                                     textToInsert +
                                     textContent.substring(offset); // Appends text that was after the original cursor position

                    // Move cursor to after the inserted text
                    const newCursorPosInNode = startIndexInNode + textToInsert.length;
                    range.setStart(node, newCursorPosInNode);
                    range.setEnd(node, newCursorPosInNode);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    console.log('[Ampersound Debug]   Text node updated directly. New range:', range);
                } else {
                    console.warn('[Ampersound Debug]   ContentEditable TextNode: Calculated startIndexInNode is negative. Fallback insert at cursor (current).');
                    range.collapse(false); // Ensure selection is collapsed at current cursor
                    selection.removeAllRanges();
                    selection.addRange(range);
                    document.execCommand('insertText', false, textToInsert);
                }
            } else {
                console.warn('[Ampersound Debug]   ContentEditable TextNode: No ampersand prefix found before cursor. Inserting at cursor.');
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
                document.execCommand('insertText', false, textToInsert);
            }
        } else {
            console.warn('[Ampersound Debug]   Cursor not directly in a text node for contentEditable. Using execCommand to insert at cursor.');
            // Ensure selection is collapsed at current cursor to avoid replacing unintended selection
            range.collapse(false); // Collapse to the end of the current range (cursor position)
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('insertText', false, textToInsert);
        }
    } else { // INPUT or TEXTAREA
        console.log('[Ampersound Debug] Handling INPUT or TEXTAREA element.');
        const text = inputElement.value;
        const cursorPos = inputElement.selectionStart;
        const textBeforeCursor = text.substring(0, cursorPos);
        console.log('[Ampersound Debug]   Input value:', text);
        console.log('[Ampersound Debug]   Cursor position:', cursorPos);
        console.log('[Ampersound Debug]   Text before cursor:', textBeforeCursor);

        const currentTokenMatch = textBeforeCursor.match(ampersandPrefixRegex);

        if (currentTokenMatch) {
            const prefixToReplace = currentTokenMatch[0];
            const replaceStartIndex = currentTokenMatch.index; // Index of the start of the prefix
            console.log('[Ampersound Debug]   Found current token to replace:', prefixToReplace, 'at index:', replaceStartIndex);

            const before = text.substring(0, replaceStartIndex);
            const after = text.substring(cursorPos); // Text that was after the cursor
            inputElement.value = before + textToInsert + after;
            console.log('[Ampersound Debug]   New input value:', inputElement.value);

            const newCursorPos = replaceStartIndex + textToInsert.length;
            inputElement.selectionStart = newCursorPos;
            inputElement.selectionEnd = newCursorPos;
            console.log('[Ampersound Debug]   New cursor position:', newCursorPos);
        } else {
            console.warn('[Ampersound Debug]   Input/Textarea: No ampersand prefix found. Inserting text at cursor.');
            const beforeCursorText = text.substring(0, cursorPos);
            const afterCursorText = text.substring(cursorPos);
            inputElement.value = beforeCursorText + textToInsert + afterCursorText;

            const newCursorPos = cursorPos + textToInsert.length;
            inputElement.selectionStart = newCursorPos;
            inputElement.selectionEnd = newCursorPos;
            console.log('[Ampersound Debug]   Input value updated by inserting. New cursor pos:', newCursorPos);
        }
    }

    hideAutocompleteUI();
    if (document.activeElement !== inputElement) {
      console.log('[Ampersound Debug] Re-focusing input element.');
      inputElement.focus();
    }
    console.log('[Ampersound Debug] Dispatching input event. (Currently commented out for testing)');
    // const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    // inputElement.dispatchEvent(inputEvent);
    console.log('[Ampersound Debug] handleAutocompleteSelection finished.');
}


function handlePotentialAutocomplete(event) {
    console.log('handlePotentialAutocomplete triggered for event:', event); // Added for debugging
    const inputElement = event.target;
    currentActiveInputForAutocomplete = inputElement;
    let textValue, cursorPos, textBeforeCursor, currentQuery;

    if (inputElement.isContentEditable) {
        const selection = window.getSelection();
        if (!selection.rangeCount || !inputElement.contains(selection.anchorNode)) {
             if (currentActiveInputForAutocomplete === inputElement) hideAutocompleteUI();
            return;
        }
        const range = selection.getRangeAt(0);
        const node = range.startContainer;
        cursorPos = range.startOffset;

        if (node.nodeType === Node.TEXT_NODE) {
            textBeforeCursor = node.nodeValue.substring(0, cursorPos);
        } else { // If not in text node, or complex structure, might be harder
            textBeforeCursor = inputElement.textContent.substring(0, cursorPos); // Simplification
        }

    } else if (typeof inputElement.selectionStart === 'number') { // INPUT or TEXTAREA
        textValue = inputElement.value;
        cursorPos = inputElement.selectionStart;
        textBeforeCursor = textValue.substring(0, cursorPos);
    } else {
        return; 
    }

    // Regex to find an ampersand token at the end of the textBeforeCursor
    const match = textBeforeCursor.match(/&([a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]*)?)?$/);

    if (match) {
        currentQuery = match[0];
        if (currentQuery === '&' || (currentQuery.length > 1 && currentQuery.length < 30)) { // Min 1 char after &, max length for query
            if (!autocompleteUIDiv) createAutocompleteUI();
            // Position will be called by updateAutocompleteSuggestions or immediately if no suggestions found (to hide)

            clearTimeout(autocompleteDebounceTimer);
            autocompleteDebounceTimer = setTimeout(async () => {
                if (currentActiveInputForAutocomplete !== inputElement) return; // Input changed
                const suggestions = await fetchSoundSuggestionsFromBackground(currentQuery);
                if (currentActiveInputForAutocomplete === inputElement) { // Still relevant?
                    if (suggestions && suggestions.length > 0) {
                        updateAutocompleteSuggestions(suggestions, inputElement, currentQuery);
                    } else {
                        hideAutocompleteUI(); // Hide if no suggestions
                    }
                }
            }, AUTOCOMPLETE_DEBOUNCE_DELAY);
        } else { // Query too long or invalid pattern.
             if (currentActiveInputForAutocomplete === inputElement) hideAutocompleteUI();
        }
    } else {
        if (currentActiveInputForAutocomplete === inputElement) {
            hideAutocompleteUI();
        }
    }
}

function setActiveSuggestion(items, index) {
    items.forEach(item => item.classList.remove('active'));
    if (items[index]) {
        items[index].classList.add('active');
        // items[index].scrollIntoView({ block: 'nearest' }); // Can be jerky, use with caution
        // Trigger hover effects for preview
        const mouseEnterEvent = new MouseEvent('mouseenter', { bubbles: true, cancelable: true });
        items[index].dispatchEvent(mouseEnterEvent);
    }
}

function handleAutocompleteKeyNavigation(event) {
    if (!autocompleteUIDiv || autocompleteUIDiv.style.display === 'none' || !currentActiveInputForAutocomplete || currentActiveInputForAutocomplete !== event.target) {
        return;
    }

    const items = autocompleteUIDiv.querySelectorAll('ul li');
    if (!items.length) return;

    let currentIndex = Array.from(items).findIndex(item => item.classList.contains('active'));

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        if (currentIndex === -1 || currentIndex === items.length - 1) {
            currentIndex = 0;
        } else {
            currentIndex++;
        }
        setActiveSuggestion(items, currentIndex);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        if (currentIndex === -1 || currentIndex === 0) {
            currentIndex = items.length - 1;
        } else {
            currentIndex--;
        }
        setActiveSuggestion(items, currentIndex);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        if (currentIndex !== -1 && items[currentIndex]) {
            items[currentIndex].click(); // Triggers selection
        } else {
            hideAutocompleteUI(); // Hide if enter pressed with no selection
        }
    } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hideAutocompleteUI();
    } else if (event.key === 'Tab') {
        // Allow tab to function normally, but hide autocomplete
        hideAutocompleteUI();
    }
}

function initializeInputListeners() {
    console.log("[Ampersound Debug] initializeInputListeners called.");
    console.log("Ampersound Autocomplete Initializing Listeners");
    injectAutocompleteStyles(); // Ensure styles are present
    createAutocompleteUI(); // Create the UI div once

    document.body.addEventListener('focusin', (event) => {
        const target = event.target;
        if ((target.tagName === 'INPUT' && (target.type === 'text' || target.type === 'search' || !target.type)) || // common input types
            target.tagName === 'TEXTAREA' || 
            target.isContentEditable) {
            
            if (target.closest('.ampersound-autocomplete-ui')) return; // Ignore focus on autocomplete itself

            // Check if on an excluded domain before attaching autocomplete listeners
            const currentHostname = window.location.hostname;
            if (isHostnameExcludedForAutocomplete(currentHostname, EXCLUDED_AUTOCOMPLETE_HOSTNAMES_MAIN)) {
                // console.log(`Ampersound Autocomplete disabled on: ${currentHostname}`);
                return; // Do not attach autocomplete listeners on this domain
            }

            // Attach if not already attached
            if (!target.dataset.ampersoundAutocompleteInput) {
                target.addEventListener('input', handlePotentialAutocomplete);
                target.dataset.ampersoundAutocompleteInput = 'true';
            }
            if (!target.dataset.ampersoundAutocompleteKeydown) {
                target.addEventListener('keydown', handleAutocompleteKeyNavigation, true); // Capture phase for keys
                target.dataset.ampersoundAutocompleteKeydown = 'true';
            }
        }
    });

    document.body.addEventListener('focusout', (event) => {
        const target = event.target;
        if (target.dataset.ampersoundAutocompleteInput || target.dataset.ampersoundAutocompleteKeydown) {
            // Delay hiding to allow click on autocomplete items
            setTimeout(() => {
                if (autocompleteUIDiv && document.activeElement && autocompleteUIDiv.contains(document.activeElement)) {
                    // Focus is now on the autocomplete UI (e.g. if it had focusable elements, though current li's are not by default)
                    return;
                }
                // If focus is not on the input that triggered it, and not on the UI itself
                if (currentActiveInputForAutocomplete === target && 
                    (!document.activeElement || !document.activeElement.closest('.ampersound-autocomplete-ui'))) {
                     hideAutocompleteUI();
                } else if (currentActiveInputForAutocomplete === target && document.activeElement !== target) {
                    //If the target lost focus and focus isn't in the autocomplete list
                    if (!autocompleteUIDiv || !autocompleteUIDiv.contains(document.activeElement)) {
                        hideAutocompleteUI();
                    }
                }

            }, 150);
        }
    });

    // Global click listener to hide autocomplete if clicked outside
    document.addEventListener('click', (event) => {
        console.log('[Ampersound Debug] Document click event listener (capture phase) INVOKED.');
        if (currentActiveInputForAutocomplete && autocompleteUIDiv && autocompleteUIDiv.style.display === 'block') {
            console.log('[Ampersound Debug] Global document click CAPTURE listener triggered (passed IF condition).');
            console.log('[Ampersound Debug]   Event target:', event.target);
            console.log('[Ampersound Debug]   Is target the autocomplete UI itself?', event.target === autocompleteUIDiv);
            console.log('[Ampersound Debug]   Does autocomplete UI contain event target?', autocompleteUIDiv.contains(event.target));
            console.log('[Ampersound Debug]   Is target the active input?', event.target === currentActiveInputForAutocomplete);

            if (!autocompleteUIDiv.contains(event.target) && event.target !== currentActiveInputForAutocomplete) {
                console.log('[Ampersound Debug]   DECISION: Click is OUTSIDE. Hiding Autocomplete UI.');
                hideAutocompleteUI();
            } else {
                console.log('[Ampersound Debug]   DECISION: Click is INSIDE or on INPUT. NOT hiding Autocomplete UI via this listener.');
            }
        }
    }, true); // Use capture to catch clicks early
}


// --- End Autocomplete Functionality ---

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
        console.warn("Error checking login status in content script (background might not be ready or context invalidated):", e.message);
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
        initializeInputListeners(); // Initialize autocomplete listeners
    });
} else {
    // DOM already loaded, process and start observing immediately
    initAndProcessDOM();
    initializeMutationObserver();
    initializeInputListeners(); // Initialize autocomplete listeners
}