// Extracted MessageBubble component — renders a single chat message (user or assistant).
// Lives outside App to avoid re-creating the component definition on every render.

import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/default-highlight";
// Import dark and light syntax-highlighter themes so code blocks respect the active mode
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { atomOneLight } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { useTheme } from "@/components/theme-provider";

/**
 * TypingIndicator — three pulsing dots that mimic a "someone is typing" animation.
 * More natural in a chat UI than a generic spinner.
 */
const TypingIndicator = () => (
    <div className="flex items-center gap-1 py-1" aria-label="Assistant is typing">
        {/* Each dot has a staggered animation-delay for the wave effect */}
        <span className="w-2 h-2 rounded-full bg-muted-foreground animate-typing-dot" />
        <span className="w-2 h-2 rounded-full bg-muted-foreground animate-typing-dot [animation-delay:0.2s]" />
        <span className="w-2 h-2 rounded-full bg-muted-foreground animate-typing-dot [animation-delay:0.4s]" />
    </div>
);

/**
 * MessageBubble — renders a single message in the chat.
 *
 * User messages:   right-aligned, themed bubble
 * Assistant messages: left-aligned, rendered as markdown with syntax-highlighted code blocks
 *
 * @param {object}  message       — { role: "user"|"assistant", content: string }
 * @param {number}  index         — position in the messages array
 * @param {number}  totalMessages — total number of messages (to detect the last one)
 * @param {boolean} isStreaming    — whether the AI is currently generating a response
 */
const MessageBubble = ({ message, index, totalMessages, isStreaming }) => {
    const isLastMessage = index === totalMessages - 1;
    // Resolve the active theme ("light" | "dark") to select the matching syntax-highlighter style
    const { resolvedTheme } = useTheme();
    // Pick the dark or light syntax-highlighting colour-scheme based on the current theme
    const codeStyle = resolvedTheme === "dark" ? atomOneDark : atomOneLight;

    return (
        // Fade-in + slide-up animation for new messages (#7 — page transition)
        <div className={`flex ${message.role === "user" && "justify-end"} mb-4 animate-message-in`}>
            <div
                className={`p-3 ${
                    message.role === "user" &&
                    /* Light mode: dark bg + white text via primary tokens.
                       Dark mode: primary flips to white so we override with muted (subtle dark gray)
                       and foreground (white text) to keep the bubble readable. */
                    "rounded-lg max-w-[80%] bg-primary text-primary-foreground dark:bg-muted dark:text-foreground shadow-sm"
                }`}
            >
                {/* Show typing indicator instead of spinner when assistant is loading (#6) */}
                {message.role === "assistant" && !message.content && isStreaming && isLastMessage ? (
                    <TypingIndicator />
                ) : message.role === "assistant" ? (
                    <ReactMarkdown
                        /* dark:prose-invert flips all typography-plugin colours for dark mode */
                        className="prose prose-sm dark:prose-invert max-w-none"
                        components={{
                            pre({ ...props }) {
                                return props.children;
                            },
                            code({ className, ...props }) {
                                const match = /language-(\w+)/.exec(className || "");
                                return match ? (
                                    <div className="relative overflow-x-auto">
                                        {/* Apply the resolved code theme so blocks match light/dark mode */}
                                        <SyntaxHighlighter
                                            language={match[1]}
                                            style={codeStyle}
                                            wrapLongLines={true}
                                            showInlineLineNumbers={true}
                                            {...props}
                                        />
                                    </div>
                                ) : (
                                    /* Inline code — slightly boosted dark contrast (#8) */
                                    <span className="bg-secondary dark:bg-secondary/80 p-[3px] rounded text-sm font-mono whitespace-pre-wrap break-words">
                                        {props.children}
                                    </span>
                                );
                            },
                        }}
                    >
                        {message.content}
                    </ReactMarkdown>
                ) : (
                    <div className="whitespace-pre-wrap">{message.content}</div>
                )}
            </div>
        </div>
    );
};

export default MessageBubble;
