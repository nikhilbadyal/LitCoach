import { useState, useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@components/ui/alert";
import { AlertCircle, CheckCircle, Clock } from "lucide-react";

// Component to show GitHub API rate limit status
const GitHubRateLimitStatus = () => {
    const [rateLimitInfo, setRateLimitInfo] = useState(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Listen for rate limit updates from background script
        const handleMessage = (message) => {
            if (message.action === "rateLimitUpdate") {
                setRateLimitInfo(message.data);
                
                // Show warning if less than 20% remaining
                const percentRemaining = (message.data.remaining / message.data.limit) * 100;
                setIsVisible(percentRemaining < 20 || message.data.remaining === 0);
            }
        };

        chrome.runtime.onMessage.addListener(handleMessage);
        
        // Request current rate limit status
        chrome.runtime.sendMessage({ action: "getRateLimitStatus" }, (response) => {
            if (response) {
                setRateLimitInfo(response);
                const percentRemaining = (response.remaining / response.limit) * 100;
                setIsVisible(percentRemaining < 20 || response.remaining === 0);
            }
        });

        return () => chrome.runtime.onMessage.removeListener(handleMessage);
    }, []);

    if (!isVisible || !rateLimitInfo) return null;

    const percentRemaining = (rateLimitInfo.remaining / rateLimitInfo.limit) * 100;
    const resetDate = new Date(rateLimitInfo.reset * 1000);
    const now = new Date();
    const minutesUntilReset = Math.ceil((resetDate - now) / 60000);

    // Determine alert variant based on remaining requests
    const getAlertVariant = () => {
        if (rateLimitInfo.remaining === 0 || percentRemaining < 10) return "destructive";
        if (percentRemaining < 20) return "warning";
        return "default";
    };

    const getIcon = () => {
        if (rateLimitInfo.remaining === 0) return <AlertCircle className="h-4 w-4" />;
        if (percentRemaining < 10) return <AlertCircle className="h-4 w-4" />;
        return <Clock className="h-4 w-4" />;
    };

    const getTitle = () => {
        if (rateLimitInfo.remaining === 0) return "GitHub API Rate Limit Exceeded";
        if (percentRemaining < 10) return "GitHub API Rate Limit Low";
        return "GitHub API Rate Limit Warning";
    };

    const getDescription = () => {
        if (rateLimitInfo.remaining === 0) {
            return `You've used all ${rateLimitInfo.limit} requests. Resets in ${minutesUntilReset} minutes at ${resetDate.toLocaleTimeString()}.`;
        }
        return `${rateLimitInfo.remaining} of ${rateLimitInfo.limit} requests remaining (${percentRemaining.toFixed(1)}%). Resets in ${minutesUntilReset} minutes.`;
    };

    return (
        <Alert 
            variant={getAlertVariant() === "warning" ? "default" : getAlertVariant()} 
            className={`mb-4 ${getAlertVariant() === "warning" ? "border-amber-500/50 text-amber-600 dark:text-amber-500 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-500 bg-amber-50 dark:bg-amber-950/20" : ""}`}
        >
            {getIcon()}
            <AlertTitle>{getTitle()}</AlertTitle>
            <AlertDescription className="text-sm">
                {getDescription()}
                {rateLimitInfo.remaining === 0 && (
                    <div className="mt-2 text-xs">
                        GitHub sync is temporarily paused. Your submissions will be queued and synced automatically when the limit resets.
                    </div>
                )}
            </AlertDescription>
        </Alert>
    );
};

export default GitHubRateLimitStatus;
