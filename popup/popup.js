const loginButton = document.getElementById('loginButton');
const logoutButton = document.getElementById('logoutButton');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const statusDiv = document.getElementById('status');

const SOCIAL_NETWORK_API_URL = 'https://socialnetwork.social'; // Base URL of the social network

async function updatePopupUI() {
    const token = await chrome.storage.local.get(['authToken']);
    const user = await chrome.storage.local.get(['username']);

    if (token.authToken && user.username) {
        statusDiv.textContent = `Logged in as ${user.username}.`;
        statusDiv.className = 'success';
        usernameInput.style.display = 'none';
        passwordInput.style.display = 'none';
        loginButton.style.display = 'none';
        logoutButton.style.display = 'block';
        document.querySelector('label[for="username"]').style.display = 'none';
        document.querySelector('label[for="password"]').style.display = 'none';
    } else {
        statusDiv.textContent = 'Please login.';
        statusDiv.className = '';
        usernameInput.style.display = 'block';
        passwordInput.style.display = 'block';
        loginButton.style.display = 'block';
        logoutButton.style.display = 'none';
        document.querySelector('label[for="username"]').style.display = 'block';
        document.querySelector('label[for="password"]').style.display = 'block';
    }
}

loginButton.addEventListener('click', async () => {
    const username = usernameInput.value;
    const password = passwordInput.value;

    if (!username || !password) {
        statusDiv.textContent = 'Username and password are required.';
        statusDiv.className = 'error';
        return;
    }

    statusDiv.textContent = 'Logging in...';
    statusDiv.className = '';

    try {
        // The actual login endpoint is /api/v1/login and expects JSON
        const response = await fetch(`${SOCIAL_NETWORK_API_URL}/api/v1/login`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ identifier: username, password: password })
            }
        );

        const data = await response.json();

        if (response.ok && data.message === "Login successful") {
            // The backend sets an HTTPOnly cookie for session management.
            // We need to rely on the browser handling this cookie for subsequent requests made by the background script.
            // For the extension to know the user is logged in, we can store a simple flag or username.
            await chrome.storage.local.set({ authToken: 'loggedIn', username: data.user.username }); // Using 'loggedIn' as a placeholder token
            statusDiv.textContent = 'Login successful!';
            statusDiv.className = 'success';
            updatePopupUI();
        } else {
            statusDiv.textContent = data.message || 'Login failed. Please check credentials.';
            statusDiv.className = 'error';
            await chrome.storage.local.remove(['authToken', 'username']);
        }
    } catch (error) {
        console.error('Login error:', error);
        statusDiv.textContent = 'Login failed. Network error or server issue.';
        statusDiv.className = 'error';
        await chrome.storage.local.remove(['authToken', 'username']);
    }
});

logoutButton.addEventListener('click', async () => {
    statusDiv.textContent = 'Logging out...';
    statusDiv.className = '';
    try {
        // Send a request to the logout endpoint if it exists and handles session termination
        // The example app doesn't explicitly show a /api/v1/logout but it's good practice
        // For now, we'll just clear local storage. The HttpOnly cookie will persist until browser closure or expiry.
        // A proper logout would involve an API call to invalidate the session/cookie on the server.
        // await fetch(`${SOCIAL_NETWORK_API_URL}/api/v1/logout`, { method: 'POST' });

        await chrome.storage.local.remove(['authToken', 'username']);
        statusDiv.textContent = 'Logged out.';
        statusDiv.className = 'success';
        updatePopupUI();

    } catch (error) {
        console.error('Logout error:', error);
        statusDiv.textContent = 'Logout failed.';
        statusDiv.className = 'error';
    }
});

// Initial UI update on popup load
document.addEventListener('DOMContentLoaded', updatePopupUI); 