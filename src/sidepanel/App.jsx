import { useState, useEffect, useRef } from "react";
import { Button } from "@components/ui/button";
import { ScrollArea } from "@components/ui/scroll-area";
import { Input } from "@components/ui/input";
import InvalidPage from "@components/invalid-page";
import GetPremiumPopUp from "@components/get-premium";
import { useToast } from "@hooks/use-toast";
import { Info, Send, StopCircle, Loader2, Trash2, CheckCircle2, XCircle, Lightbulb } from "lucide-react";
import ReportIssueButton from "@components/report-issue";
// #13 — MessageBubble extracted into its own file for cleaner code and avoiding re-creation per render
import MessageBubble from "@components/message-bubble";
import { ThemeToggle } from "@/components/theme-toggle";

// Dynamically construct the options page URL so it works across reinstalls and ID changes
const OPTIONS_PAGE = chrome.runtime.getURL("src/options/index.html");
const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const MAX_CHAR_LIMIT = 275;
const SUGGESTIONS = [
    "What's a good starting point?",
    "Can you explain the description?",
    "What's the key concept?",
    "Can you give me a hint?",
    "What is the time complexity?",
];

/**
 * #12 — CircularCharCounter: a small SVG ring that fills as the user types.
 * Replaces the plain "0/275" text with a visual progress indicator.
 * Turns red when the character limit is reached.
 */
const CircularCharCounter = ({ current, max }) => {
    // SVG circle geometry
    const radius = 10;
    const circumference = 2 * Math.PI * radius;
    // How much of the ring to fill (0 → full circumference = empty, circumference → 0 = full)
    const progress = Math.min(current / max, 1);
    const dashOffset = circumference * (1 - progress);
    // Colour: muted by default, red when limit is reached
    const isAtLimit = current >= max;
    const strokeColor = isAtLimit ? "hsl(0 84.2% 60.2%)" : "hsl(var(--muted-foreground))";

    return (
        <div className="flex items-center gap-1" title={`${current}/${max} characters`}>
            {/* SVG ring rotated -90° so progress starts from the top */}
            <svg width="24" height="24" className="char-ring">
                {/* Background track */}
                <circle
                    cx="12" cy="12" r={radius}
                    fill="none"
                    stroke="hsl(var(--border))"
                    strokeWidth="2"
                />
                {/* Filled progress arc */}
                <circle
                    cx="12" cy="12" r={radius}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth="2"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                    strokeLinecap="round"
                />
            </svg>
            {/* Numeric counter — only show when user starts typing */}
            {current > 0 && (
                <span className={`text-[10px] ${isAtLimit ? "text-red-500" : "text-muted-foreground"}`}>
                    {current}
                </span>
            )}
        </div>
    );
};

function App() {
    const { toast } = useToast();
    const messagesEndRef = useRef(null);
    const abortControllerRef = useRef(null);
    const inputRef = useRef(null);
    // Ref to track the current problem slug so we can clear chat on problem switches
    const currentProblemRef = useRef(null);
    const [googleUserID, setGoogleUserID] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isValidPage, setIsValidPage] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(true);
    // Track the last GitHub sync status for the header badge ("success" | "error" | null)
    const [syncStatus, setSyncStatus] = useState(null);
    // Track if a sync is currently in progress
    const [isSyncing, setIsSyncing] = useState(false);
    const [premiumAlert, setPremiumAlert] = useState({
        open: false,
        alertMessage: null,
    });

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    useEffect(() => {
        const fetchData = async () => {
            // Check backend health — don't block UI setup if backend is temporarily down
            try {
                const response = await fetch(`${API_URL}/health`);
                if (!response.ok) console.warn("Backend health check failed");
            } catch (error) {
                console.warn("Backend is unreachable — AI features will be unavailable", error);
            }

            const [currentTab] = await new Promise((resolve) => {
                chrome.tabs.query({ active: true, currentWindow: true }, resolve);
            });

            const isValid = currentTab?.url?.startsWith("https://leetcode.com/problems/") || false;
            setIsValidPage(isValid);

            // Seed the problem slug ref so first-load doesn't falsely clear chat
            if (isValid && currentTab?.url) {
                const slug = currentTab.url.replace("https://leetcode.com/problems/", "").split("/")[0];
                currentProblemRef.current = slug;
            }

            const { google_user_id } = await new Promise((resolve) =>
                chrome.storage.sync.get(["google_user_id"], resolve),
            );

            setGoogleUserID(google_user_id);

            // Read initial sync status for the header badge
            chrome.storage.local.get(["last_sync_status", "is_syncing"], (result) => {
                if (result.last_sync_status) setSyncStatus(result.last_sync_status);
                if (result.is_syncing) setIsSyncing(result.is_syncing);
            });
        };

        fetchData();

        // Listen for sync status changes pushed from the background script
        const onStorageChanged = (changes, area) => {
            if (area === "local" && changes.last_sync_status) {
                setSyncStatus(changes.last_sync_status.newValue);
            }
            if (area === "local" && changes.is_syncing) {
                setIsSyncing(changes.is_syncing.newValue);
            }
        };
        chrome.storage.onChanged.addListener(onStorageChanged);

        chrome.runtime.onMessage.addListener(updateIsValidPage);
        return () => {
            chrome.runtime.onMessage.removeListener(updateIsValidPage);
            chrome.storage.onChanged.removeListener(onStorageChanged);
        };
    }, []);

    // Automatically refocus the input after the AI finishes generating so users can type a follow-up immediately
    useEffect(() => {
        if (!isLoading) {
            setTimeout(() => inputRef.current?.focus(), 10);
        }
    }, [isLoading]);

    const updateIsValidPage = (message) => {
        if (message.isLeetCodeProblem !== undefined) {
            setIsValidPage(message.isLeetCodeProblem);
        }
        // Clear chat history when the user navigates to a different LeetCode problem
        if (message.problemSlug && message.problemSlug !== currentProblemRef.current) {
            currentProblemRef.current = message.problemSlug;
            setMessages([]);
            setShowSuggestions(true);
        }
    };

    const getLeetCodePageData = async () => {
        const [code, description] = await Promise.all([
            new Promise((resolve) => chrome.runtime.sendMessage({ action: "getEditorValue" }, resolve)),
            new Promise((resolve) => chrome.runtime.sendMessage({ action: "getProblemDescription" }, resolve)),
        ]);

        if (!code || !description) {
            throw new Error("Failed to fetch code or problem description");
        }

        return { code, description };
    };

    const handleInputChange = (e) => {
        const newValue = e.target.value;
        if (newValue.length <= MAX_CHAR_LIMIT) {
            setInput(newValue);
            setShowSuggestions(false);
        }
    };

    const handleSendMessage = async () => {
        if (!input.trim() || isLoading) return;

        setIsLoading(true);
        setInput("");

        try {
            const userMessage = { role: "user", content: input };
            const assistantMessage = { role: "assistant", content: "" };
            setMessages((prev) => [...prev, userMessage, assistantMessage]);

            const { code, description } = await getLeetCodePageData();
            abortControllerRef.current = new AbortController();

            const response = await fetch(`${API_URL}/ai/assistance`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    problem_description: description,
                    context: messages,
                    code: code,
                    prompt: input,
                    google_user_id: googleUserID,
                }),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                if (response.status === 403) {
                    const errorData = await response.json();
                    setPremiumAlert({ open: true, alertMessage: errorData.detail });
                    setMessages((prev) => prev.slice(0, -1));
                    return;
                }
                throw new Error(`Server responded with ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                assistantMessage.content += decoder.decode(value);
                setMessages((prev) => [...prev.slice(0, -1), { ...assistantMessage }]);
            }
        } catch (error) {
            if (error.name !== "AbortError") {
                console.error("Error occurred when generating response", error);
                toast({
                    variant: "destructive",
                    title: "An error occurred",
                    description: error.message,
                });
                setMessages((prev) => prev.slice(0, -1));
            }
        } finally {
            setIsLoading(false);
            abortControllerRef.current = null;
        }
    };

    if (isValidPage) {
        return (
                <div className="h-screen flex flex-col bg-background">
                    {/* ── Header bar ── */}
                    <div className="p-2 border-b flex justify-between items-center">
                        <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => window.open(OPTIONS_PAGE)} title="Settings">
                                <Info className="h-5 w-5" />
                            </Button>
                            {/* Sync status indicators */}
                            {isSyncing && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" title="Syncing to GitHub..." />}
                            {!isSyncing && syncStatus === "success" && <CheckCircle2 className="h-4 w-4 text-green-500" title="Last sync succeeded" />}
                            {!isSyncing && syncStatus === "error" && <XCircle className="h-4 w-4 text-red-500" title="Last sync failed" />}
                        </div>
                        <div className="flex items-center gap-1">
                            {/* Clear chat button — only visible when there are messages */}
                            {messages.length > 0 && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                        setMessages([]);
                                        setShowSuggestions(true);
                                    }}
                                    title="Clear chat"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            )}
                            <ThemeToggle />
                            <ReportIssueButton />
                        </div>
                    </div>

                {/* ── Chat area ── */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    <ScrollArea className="flex-1 px-4">
                        <div className="py-2 space-y-4">
                            {messages.map((message, index) => (
                                // #13 — Using the extracted MessageBubble component
                                <MessageBubble
                                    key={index}
                                    message={message}
                                    index={index}
                                    totalMessages={messages.length}
                                    isStreaming={isLoading}
                                />
                            ))}
                            <div ref={messagesEndRef} />
                        </div>
                    </ScrollArea>

                    {/* #4 — Welcome message + #5 — Suggestion chips now in normal flow (not absolute) */}
                    {showSuggestions && (
                        <div className="px-4 pb-3 pt-2 border-t border-border/50">
                            {/* #4 — Friendly welcome message for first-time context */}
                            <div className="flex items-center gap-2 mb-3 text-muted-foreground">
                                <Lightbulb className="h-4 w-4 shrink-0" />
                                <p className="text-sm">Ask me anything about this problem</p>
                            </div>
                            {/* #5 — Chips are now part of the normal layout flow, no more overlap */}
                            <div className="flex gap-2 flex-wrap">
                                {SUGGESTIONS.map((suggestion, index) => (
                                    <Button
                                        key={index}
                                        variant="outline"
                                        size="sm"
                                        className="text-sm hover:bg-muted"
                                        onClick={() => {
                                            setInput(suggestion);
                                            setShowSuggestions(false);
                                        }}
                                    >
                                        {suggestion}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Input area ── */}
                <div className="border-t">
                    <div className="p-4 pb-2 flex gap-2 items-end">
                        <textarea
                            ref={inputRef}
                            autoFocus
                            rows={1}
                            placeholder="Ask a question... (Shift+Enter for new line)"
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage();
                                }
                            }}
                            disabled={isLoading}
                            className="flex-1 min-h-[40px] max-h-[150px] resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <div className="flex items-center gap-2 pb-1">
                            {/* #12 — Circular progress ring replaces the raw text counter */}
                            <CircularCharCounter current={input.length} max={MAX_CHAR_LIMIT} />
                        {isLoading ? (
                            // #9 — Keyboard shortcut tooltip on stop button
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => {
                                    abortControllerRef.current?.abort();
                                    setIsLoading(false);
                                }}
                                title="Stop generating"
                            >
                                <StopCircle className="h-5 w-5" />
                            </Button>
                        ) : (
                            // #9 — Keyboard shortcut tooltip on send button
                            <Button size="icon" disabled={!input.trim()} onClick={handleSendMessage} title="Send (Enter)">
                                <Send className="h-5 w-5" />
                            </Button>
                        )}
                        </div>
                    </div>
                </div>

                <GetPremiumPopUp
                    googleUserID={googleUserID}
                    isOpen={premiumAlert.open}
                    message={premiumAlert.alertMessage}
                    onClose={() => setPremiumAlert({ open: false })}
                />
            </div>
        );
    }

    return <InvalidPage />;
}

export default App;
