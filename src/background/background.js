import axios from "axios";

console.log("Background script running!");

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
                const details = await fetchSubmissionDetails(submissionMatch[1]);
                if (!details) {
                    console.error("Failed to fetch submission details");
                    return;
                }

                if (details.runtimeError || details.compileError) {
                    console.log("Submission failed with runtime error or compile error");
                    return;
                }

                if (details.statusDisplay !== "Accepted") {
                    console.log(`Submission was ${details.statusDisplay}, not syncing.`);
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
                    return;
                }

                try {
                    await axios.post(`${API_URL}/user/github/submission`, {
                        ...details,
                        github_repo_id: data.selected_repo_id,
                        github_access_token: data.github_access_token,
                    });
                    console.log("Successfully submitted problem to user's selected github repo");
                    // Store the last sync result so the sidepanel badge and GitHub card can display it
                    chrome.storage.local.set({
                        last_sync_status: "success",
                        last_synced_file: `${details.question.titleSlug}/${details.lang.name}`
                    });
                } catch (error) {
                    console.error("Error submitting problem to GitHub via API", error);
                    // Store sync failure so the sidepanel header badge turns red
                    chrome.storage.local.set({ last_sync_status: "error" });

                    if (error.response?.status === 401 || error.response?.status === 403) {
                        console.error("GitHub access token is revoked or lacks permissions. Clearing...");
                        chrome.storage.sync.remove(["github_access_token"]);
                        chrome.action.setBadgeText({ text: "!" });
                        chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
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
                }
            }
        });
    }
});

// Check if the user has Github sync
chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (message.action === "isGitHubAuthenticated") {
        chrome.storage.sync.get(["github_access_token"], async (stored) => {
            if (!stored.github_access_token) return sendResponse(false);

            try {
                const { data } = await axios.get(`${API_URL}/user/github/info`, {
                    params: {
                        github_access_token: stored.github_access_token,
                    },
                });
                await chrome.storage.sync.set({ github_user_data: data });
                sendResponse(true);
            } catch (error) {
                console.error("User may not be authenticated with GitHub", error);
                if (error.response?.status === 401 || error.response?.status === 403) {
                    chrome.storage.sync.remove(["github_access_token"]);
                    chrome.action.setBadgeText({ text: "!" });
                    chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
                }
                sendResponse(false);
            }
        });

        return true;
    }
});

// Process offline sync queue
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "flushSyncQueue") {
        console.log("Flushing offline sync queue...");
        chrome.storage.local.get(["sync_queue"], async (localData) => {
            const queue = localData.sync_queue || [];
            if (queue.length === 0) return;

            chrome.storage.sync.get(["selected_repo_id", "github_access_token"], async (syncData) => {
                if (!syncData.github_access_token || !syncData.selected_repo_id) return;

                const remainingQueue = [];
                for (const item of queue) {
                    try {
                        await axios.post(`${API_URL}/user/github/submission`, {
                            ...item.details,
                            github_repo_id: syncData.selected_repo_id,
                            github_access_token: syncData.github_access_token,
                        });
                        console.log("Successfully flushed submission from queue!");
                    } catch (error) {
                        console.error("Failed to flush submission from queue", error);
                        if (error.response?.status === 401 || error.response?.status === 403) {
                            console.error("GitHub access token invalid or lacks permissions during queue flush. Clearing...");
                            chrome.storage.sync.remove(["github_access_token"]);
                            chrome.action.setBadgeText({ text: "!" });
                            chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
                            remainingQueue.push(...queue.slice(queue.indexOf(item)));
                            break;
                        }

                        if (!error.response || error.response.status >= 500) {
                            remainingQueue.push(item);
                        }
                    }
                }

                chrome.storage.local.set({ sync_queue: remainingQueue });

                if (remainingQueue.length > 0) {
                    console.log(`${remainingQueue.length} items remaining in queue. Retrying in 5 mins.`);
                    chrome.alarms.create("flushSyncQueue", { delayInMinutes: 5 });
                }
            });
        });
    }
});
