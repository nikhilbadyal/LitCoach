import axios from "axios";

console.log("Background script running!");

// Clean up stale processing flags on startup (older than 5 minutes)
chrome.storage.local.get(null, (items) => {
    const now = Date.now();
    const staleKeys = [];
    
    Object.keys(items).forEach(key => {
        if (key.startsWith("processing_")) {
            const timestamp = items[key];
            // If processing flag is older than 5 minutes, it's stale
            if (now - timestamp > 5 * 60 * 1000) {
                staleKeys.push(key);
            }
        }
    });
    
    if (staleKeys.length > 0) {
        console.log(`Cleaning up ${staleKeys.length} stale processing flags`);
        chrome.storage.local.remove(staleKeys);
    }
});

// Add request interceptor to log all GitHub API calls
axios.interceptors.request.use((config) => {
    if (config.url?.includes('api.github.com')) {
        console.log(`[GitHub API Request] ${config.method?.toUpperCase()} ${config.url}`);
        console.trace('Call stack:'); // Shows where the call came from
    }
    return config;
});

// Add response interceptor to log rate limit info
axios.interceptors.response.use(
    (response) => {
        if (response.config.url?.includes('api.github.com')) {
            const remaining = response.headers['x-ratelimit-remaining'];
            const limit = response.headers['x-ratelimit-limit'];
            const reset = response.headers['x-ratelimit-reset'];
            console.log(`[GitHub API Response] Rate Limit: ${remaining}/${limit} remaining (resets at ${new Date(reset * 1000).toLocaleString()})`);
            
            // Store rate limit info and broadcast to UI
            const rateLimitInfo = {
                remaining: parseInt(remaining) || 0,
                limit: parseInt(limit) || 5000,
                reset: parseInt(reset) || 0
            };
            chrome.storage.local.set({ github_rate_limit: rateLimitInfo });
            
            // Broadcast to all extension pages
            chrome.runtime.sendMessage({ 
                action: "rateLimitUpdate", 
                data: rateLimitInfo 
            }).catch(() => {}); // Ignore if no listeners
        }
        return response;
    },
    (error) => {
        if (error.config?.url?.includes('api.github.com')) {
            const remaining = error.response?.headers['x-ratelimit-remaining'];
            const limit = error.response?.headers['x-ratelimit-limit'];
            const reset = error.response?.headers['x-ratelimit-reset'];
            console.error(`[GitHub API Error] ${error.response?.status} - Rate Limit: ${remaining}/${limit} remaining`);
            
            // Store rate limit info even on error
            if (remaining !== undefined) {
                const rateLimitInfo = {
                    remaining: parseInt(remaining) || 0,
                    limit: parseInt(limit) || 5000,
                    reset: parseInt(reset) || 0
                };
                chrome.storage.local.set({ github_rate_limit: rateLimitInfo });
                
                // Broadcast to all extension pages
                chrome.runtime.sendMessage({ 
                    action: "rateLimitUpdate", 
                    data: rateLimitInfo 
                }).catch(() => {});
            }
        }
        return Promise.reject(error);
    }
);

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        chrome.runtime.setUninstallURL("https://www.nikhilbadyal.com/#contact");
    }
});

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const LEETCODE_PROBLEM_URL = "https://leetcode.com/problems/";
const LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql";
const LEETCODE_SUBMISSION_DETAILS_QUERY = `
    query submissionDetails($submissionId: Int!) {
        submissionDetails(submissionId: $submissionId) {
            runtimeDisplay
            runtimePercentile
            memoryDisplay
            memoryPercentile
            code
            timestamp
            lang {
                name
                verboseName
            }
            question {
                questionId
                title
                titleSlug
                content
                difficulty
            }
            runtimeError
            compileError
            statusDisplay
        }
    }
`;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Function to check if the current tab is a LeetCode problem
function checkIfLeetCodeProblem(tab) {
    const isLeetCodeProblem = tab.url && tab.url.startsWith(LEETCODE_PROBLEM_URL);
    // Extract the problem slug so the sidepanel can detect problem switches and clear stale chat
    const problemSlug = isLeetCodeProblem
        ? tab.url.replace(LEETCODE_PROBLEM_URL, "").split("/")[0]
        : null;
    chrome.runtime.sendMessage({ isLeetCodeProblem, problemSlug }, () => {
        const errorMessage = chrome.runtime.lastError?.message;
        // Ignore these errors since sidepanel may not always be open
        if (
            errorMessage &&
            errorMessage !== "Could not establish connection. Receiving end does not exist." &&
            errorMessage !== "The message port closed before a response was received."
        ) {
            console.error("Error checking if tab is a LeetCode problem", errorMessage);
        }
    });
}

// Monitor for tab updates
chrome.tabs.onUpdated.addListener((_, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url) {
        checkIfLeetCodeProblem(tab);
    }
});

// Monitor for tab switches
chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId, (tab) => {
        checkIfLeetCodeProblem(tab);
    });
});

// Get the editor value from the Monaco editor
chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (message.action === "getEditorValue") {
        chrome.tabs.query({ active: true, currentWindow: true }, async ([{ id, url }]) => {
            if (!url.startsWith(LEETCODE_PROBLEM_URL)) return sendResponse({ success: false });

            const [result] = await chrome.scripting.executeScript({
                target: { tabId: id },
                world: "MAIN",
                func: () => {
                    return window.monaco.editor.getModels()[0].getValue();
                },
            });
            sendResponse(result?.result);
        });
        return true;
    }
});

// Get the problem description from the meta tag
chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (message.action === "getProblemDescription") {
        chrome.tabs.query({ active: true, currentWindow: true }, async ([{ id, url }]) => {
            if (!url.startsWith(LEETCODE_PROBLEM_URL)) return sendResponse({ success: false });

            const [result] = await chrome.scripting.executeScript({
                target: { tabId: id },
                func: () => document.querySelector('meta[name="description"]')?.content || null,
            });
            sendResponse(result?.result);
        });
        return true;
    }
});

// Function to fetch submission details using GraphQL
async function fetchSubmissionDetails(submissionId) {
    try {
        const response = await axios.post(LEETCODE_GRAPHQL_URL, {
            query: LEETCODE_SUBMISSION_DETAILS_QUERY,
            variables: { submissionId: parseInt(submissionId) },
        });

        return response.data.data.submissionDetails;
    } catch (error) {
        console.error("Error fetching LeetCode submission details", error);
        return null;
    }
}

// Monitor for submission result changes
chrome.tabs.onUpdated.addListener((_, changeInfo, tab) => {
    if (tab.url?.startsWith(LEETCODE_PROBLEM_URL) && changeInfo.status === "complete") {
        chrome.storage.sync.get(["sync_enabled", "selected_repo_id", "github_access_token"], async (data) => {
            if (!data.sync_enabled || !data.selected_repo_id || !data.github_access_token) return;

            const submissionMatch = tab.url.match(/submissions\/(\d+)/);
            if (submissionMatch) {
                const submissionId = submissionMatch[1];
                
                // Check if we're already processing this submission
                const processingKey = `processing_${submissionId}`;
                chrome.storage.local.get([processingKey], async (result) => {
                    if (result[processingKey]) {
                        console.log(`Submission ${submissionId} is already being processed. Skipping duplicate.`);
                        return;
                    }
                    
                    // Mark as processing
                    chrome.storage.local.set({ [processingKey]: Date.now(), is_syncing: true });
                    
                    const details = await fetchSubmissionDetails(submissionId);
                    if (!details) {
                        console.error("Failed to fetch submission details");
                        chrome.storage.local.remove([processingKey]);
                        return;
                    }

                    if (details.runtimeError || details.compileError) {
                        console.log("Submission failed with runtime error or compile error");
                        chrome.storage.local.remove([processingKey]);
                        return;
                    }

                    if (details.statusDisplay !== "Accepted") {
                        console.log(`Submission was ${details.statusDisplay}, not syncing.`);
                        chrome.storage.local.remove([processingKey]);
                        return;
                    }

                    const now = new Date();
                    const submissionDate = new Date(details.timestamp * 1000);
                    if (
                        submissionDate.getUTCFullYear() !== now.getUTCFullYear() ||
                        submissionDate.getUTCMonth() !== now.getUTCMonth() ||
                        submissionDate.getUTCDate() !== now.getUTCDate() ||
                        submissionDate.getUTCHours() !== now.getUTCHours() ||
                        submissionDate.getUTCMinutes() !== now.getUTCMinutes()
                    ) {
                        console.log("Submission was not made recently");
                        chrome.storage.local.remove([processingKey]);
                        return;
                    }

                    try {
                        const res = await axios.post(`${API_URL}/user/github/submission`, {
                            ...details,
                            github_repo_id: data.selected_repo_id,
                            github_access_token: data.github_access_token,
                        });
                        console.log("Successfully submitted problem to user's selected github repo", res.data.github_url);
                        
                        // Store the last sync result so the sidepanel badge and GitHub card can display it
                        chrome.storage.local.set({
                            last_sync_status: "success",
                            last_synced_file: `${details.question.titleSlug}/${details.lang.name}`
                        });
                        
                        // Add to sync history
                        chrome.storage.sync.get(["github_user_data"], async (syncData) => {
                            const repoName = syncData.github_user_data?.repos?.find(
                                r => r.id.toString() === data.selected_repo_id.toString()
                            )?.name;
                            await addToSyncHistory(
                                details, 
                                "success", 
                                repoName,
                                syncData.github_user_data?.github_name,
                                res.data.github_url
                            );
                        });
                        
                        // Show success notification
                        chrome.notifications.create({
                            type: "basic",
                            iconUrl: "/icon128.png",
                            title: "Sync Complete",
                            message: `Successfully synced ${details.question.title} to GitHub!`,
                            priority: 0
                        });
                        
                        // Clean up processing flag after successful sync
                        chrome.storage.local.remove([processingKey]);
                        chrome.storage.local.set({ is_syncing: false });
                    } catch (error) {
                        console.error("Error submitting problem to GitHub via API", error);
                        // Store sync failure so the sidepanel header badge turns red
                        chrome.storage.local.set({ last_sync_status: "error" });
                        
                        // Add to sync history as error
                        await addToSyncHistory(details, "error");

                        // Handle rate limiting - queue for later
                        if (error.response?.status === 429) {
                            console.log("GitHub API rate limit exceeded. Queueing submission for retry...");
                            
                            // Show notification to user
                            chrome.notifications.create({
                                type: "basic",
                                iconUrl: "/icon128.png",
                                title: "GitHub Rate Limit Exceeded",
                                message: "Your submission has been queued and will sync automatically when the limit resets.",
                                priority: 1
                            });
                            
                            chrome.storage.local.get(["sync_queue"], (result) => {
                                const queue = result.sync_queue || [];
                                queue.push({
                                    details,
                                    timestamp: Date.now()
                                });
                                chrome.storage.local.set({ sync_queue: queue });
                                // Retry in 10 minutes when rate limit might be reset
                                chrome.alarms.create("flushSyncQueue", { delayInMinutes: 10 });
                            });
                            
                            // Clean up processing flag
                            chrome.storage.local.remove([processingKey]);
                            chrome.storage.local.set({ is_syncing: false });
                            return;
                        }

                        if (error.response?.status === 401 || error.response?.status === 403) {
                            console.error("GitHub access token is revoked or lacks permissions. Clearing...");
                            
                            // Check if it's actually an auth error or just rate limit
                            const errorDetail = error.response?.data?.detail || "";
                            if (errorDetail.includes("rate limit")) {
                                console.log("403 was due to rate limit, not auth failure. Keeping token and queueing.");
                                // Queue it instead of clearing token
                                chrome.storage.local.get(["sync_queue"], (result) => {
                                    const queue = result.sync_queue || [];
                                    queue.push({
                                        details,
                                        timestamp: Date.now()
                                    });
                                    chrome.storage.local.set({ sync_queue: queue });
                                    chrome.alarms.create("flushSyncQueue", { delayInMinutes: 10 });
                                });
                            } else {
                                // Real auth failure - clear token
                                chrome.storage.sync.remove(["github_access_token"]);
                                chrome.action.setBadgeText({ text: "!" });
                                chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
                            }
                            
                            chrome.storage.local.remove([processingKey]);
                            chrome.storage.local.set({ is_syncing: false });
                            return;
                        }

                        // Network error or 5xx server error - queue it up!
                        if (!error.response || error.response.status >= 500) {
                            console.log("Queueing submission for offline retry...");
                            chrome.storage.local.get(["sync_queue"], (result) => {
                                const queue = result.sync_queue || [];
                                queue.push({
                                    details,
                                    timestamp: Date.now()
                                });
                                chrome.storage.local.set({ sync_queue: queue });
                                chrome.alarms.create("flushSyncQueue", { delayInMinutes: 1 });
                            });
                        }
                        
                        // Clean up processing flag
                        chrome.storage.local.remove([processingKey]);
                        chrome.storage.local.set({ is_syncing: false });
                    }
                });
            }
        });
    }
});

// Check if the user has Github sync
chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (message.action === "isGitHubAuthenticated") {
        chrome.storage.sync.get(["github_access_token", "github_user_data", "github_data_cache_time"], async (stored) => {
            if (!stored.github_access_token) return sendResponse(false);

            // Cache GitHub user data for 5 minutes to reduce API calls
            const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
            const now = Date.now();
            const cacheTime = stored.github_data_cache_time || 0;
            
            // If we have cached data and it's still fresh, use it
            if (stored.github_user_data && (now - cacheTime) < CACHE_DURATION) {
                console.log("Using cached GitHub user data");
                sendResponse(true);
                return;
            }

            // Cache expired or doesn't exist, fetch fresh data
            try {
                const { data } = await axios.get(`${API_URL}/user/github/info`, {
                    params: {
                        github_access_token: stored.github_access_token,
                    },
                });
                await chrome.storage.sync.set({ 
                    github_user_data: data,
                    github_data_cache_time: now // Store cache timestamp
                });
                console.log("Fetched and cached fresh GitHub user data");
                sendResponse(true);
            } catch (error) {
                console.error("User may not be authenticated with GitHub", error);
                
                // Handle rate limiting specifically
                if (error.response?.status === 429) {
                    console.error("GitHub API rate limit exceeded");
                    // If we have cached data, use it even if expired
                    if (stored.github_user_data) {
                        console.log("Using stale cached data due to rate limit");
                        sendResponse(true);
                        return;
                    }
                }
                
                // Only clear token on 401 (unauthorized), not 403 (which could be rate limit)
                if (error.response?.status === 401) {
                    console.error("GitHub token is invalid or expired. Clearing...");
                    chrome.storage.sync.remove(["github_access_token", "github_user_data", "github_data_cache_time"]);
                    chrome.action.setBadgeText({ text: "!" });
                    chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
                }
                
                // For 403, check if it's rate limit or auth issue
                if (error.response?.status === 403) {
                    const errorDetail = error.response?.data?.detail || "";
                    // Only clear token if it's explicitly an auth error, not rate limit
                    if (errorDetail.includes("authentication") || errorDetail.includes("token")) {
                        console.error("GitHub authentication failed. Clearing token...");
                        chrome.storage.sync.remove(["github_access_token", "github_user_data", "github_data_cache_time"]);
                        chrome.action.setBadgeText({ text: "!" });
                        chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
                    } else {
                        console.error("GitHub API returned 403 (likely rate limit). Keeping token.");
                        // Use cached data if available
                        if (stored.github_user_data) {
                            console.log("Using stale cached data due to 403 error");
                            sendResponse(true);
                            return;
                        }
                    }
                }
                
                sendResponse(false);
            }
        });

        return true;
    }
    
    // Handle rate limit status requests
    if (message.action === "getRateLimitStatus") {
        chrome.storage.local.get(["github_rate_limit"], (result) => {
            sendResponse(result.github_rate_limit || null);
        });
        return true;
    }
    
    // Handle manual flush sync queue request
    if (message.action === "flushSyncQueueNow") {
        flushSyncQueue()
            .then(() => sendResponse({ success: true }))
            .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

// Helper function to add sync event to history
// Keeps track of last 50 sync attempts for user reference
async function addToSyncHistory(details, status, repoName = null, githubUsername = null, githubUrl = null) {
    chrome.storage.local.get(["sync_history"], (result) => {
        const history = result.sync_history || [];
        
        // Add new entry at the beginning
        history.unshift({
            problemTitle: details.question?.title,
            problemSlug: details.question?.titleSlug,
            language: details.lang?.name,
            status: status, // "success", "error", "queued"
            timestamp: Date.now(),
            repoName: repoName,
            githubUsername: githubUsername,
            githubUrl: githubUrl
        });
        
        // Keep only last 50 entries to avoid storage bloat
        const trimmedHistory = history.slice(0, 50);
        
        chrome.storage.local.set({ sync_history: trimmedHistory });
    });
}

// Process offline sync queue - extracted as reusable function
async function flushSyncQueue() {
    console.log("Flushing offline sync queue...");
    
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(["sync_queue"], async (localData) => {
            const queue = localData.sync_queue || [];
            if (queue.length === 0) {
                resolve();
                return;
            }

            chrome.storage.sync.get(["selected_repo_id", "github_access_token", "github_user_data"], async (syncData) => {
                if (!syncData.github_access_token || !syncData.selected_repo_id) {
                    reject(new Error("GitHub not authenticated or no repo selected"));
                    return;
                }

                const remainingQueue = [];
                let successCount = 0;
                
                for (const item of queue) {
                    try {
                        const res = await axios.post(`${API_URL}/user/github/submission`, {
                            ...item.details,
                            github_repo_id: syncData.selected_repo_id,
                            github_access_token: syncData.github_access_token,
                        });
                        console.log("Successfully flushed submission from queue!", res.data.github_url);
                        successCount++;
                        
                        // Add to sync history
                        const repoName = syncData.github_user_data?.repos?.find(
                            r => r.id.toString() === syncData.selected_repo_id.toString()
                        )?.name;
                        await addToSyncHistory(
                            item.details, 
                            "success", 
                            repoName,
                            syncData.github_user_data?.github_name,
                            res.data.github_url
                        );
                        
                        // Update last sync status
                        chrome.storage.local.set({
                            last_sync_status: "success",
                            last_synced_file: `${item.details.question.titleSlug}/${item.details.lang.name}`
                        });
                    } catch (error) {
                        console.error("Failed to flush submission from queue", error);
                        
                        // Add to sync history as error
                        await addToSyncHistory(item.details, "error");
                        
                        if (error.response?.status === 401 || error.response?.status === 403) {
                            console.error("GitHub access token invalid or lacks permissions during queue flush. Clearing...");
                            chrome.storage.sync.remove(["github_access_token"]);
                            chrome.action.setBadgeText({ text: "!" });
                            chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
                            remainingQueue.push(...queue.slice(queue.indexOf(item)));
                            break;
                        }

                        if (!error.response || error.response.status >= 500 || error.response.status === 429) {
                            remainingQueue.push(item);
                        }
                    }
                }

                chrome.storage.local.set({ sync_queue: remainingQueue });

                if (remainingQueue.length > 0) {
                    console.log(`${remainingQueue.length} items remaining in queue. Retrying in 5 mins.`);
                    chrome.alarms.create("flushSyncQueue", { delayInMinutes: 5 });
                }
                
                if (successCount > 0) {
                    // Show success notification
                    chrome.notifications.create({
                        type: "basic",
                        iconUrl: "/icon128.png",
                        title: "Sync Complete",
                        message: `Successfully synced ${successCount} submission${successCount !== 1 ? 's' : ''} to GitHub!`,
                        priority: 1
                    });
                }
                
                resolve();
            });
        });
    });
}

// Process offline sync queue
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "flushSyncQueue") {
        await flushSyncQueue();
    }
});
