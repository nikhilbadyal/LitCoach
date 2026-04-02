import { useState, useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@components/ui/alert";
import { Button } from "@components/ui/button";
import { Loader2, CheckCircle, Clock, RefreshCw } from "lucide-react";
import { useToast } from "@hooks/use-toast";

// Component to show pending sync queue status with manual retry capability
const SyncQueueStatus = () => {
    const { toast } = useToast();
    const [queueInfo, setQueueInfo] = useState({ count: 0, nextRetry: null });
    const [isRetrying, setIsRetrying] = useState(false);

    useEffect(() => {
        // Check queue status on mount and periodically
        const checkQueue = () => {
            chrome.storage.local.get(["sync_queue"], (result) => {
                const queue = result.sync_queue || [];
                setQueueInfo({ count: queue.length, nextRetry: null });
            });

            // Check if there's a pending alarm
            chrome.alarms.get("flushSyncQueue", (alarm) => {
                if (alarm) {
                    setQueueInfo((prev) => ({ ...prev, nextRetry: alarm.scheduledTime }));
                }
            });
        };

        checkQueue();
        const interval = setInterval(checkQueue, 10000); // Check every 10 seconds

        return () => clearInterval(interval);
    }, []);

    // Manual retry handler - triggers immediate queue flush
    const handleManualRetry = async () => {
        setIsRetrying(true);
        
        try {
            // Send message to background script to flush queue immediately
            chrome.runtime.sendMessage({ action: "flushSyncQueueNow" }, (response) => {
                if (response?.success) {
                    toast({
                        title: "Retry Started",
                        description: "Attempting to sync queued submissions now...",
                    });
                } else {
                    toast({
                        title: "Retry Failed",
                        description: response?.error || "Could not retry at this time. Please try again later.",
                        variant: "destructive",
                    });
                }
                setIsRetrying(false);
            });
        } catch (error) {
            console.error("Manual retry failed:", error);
            toast({
                title: "Retry Failed",
                description: "An error occurred while retrying. Please try again.",
                variant: "destructive",
            });
            setIsRetrying(false);
        }
    };

    if (queueInfo.count === 0) return null;

    // Calculate time until next automatic retry
    const getRetryText = () => {
        if (!queueInfo.nextRetry) return "Retrying soon...";
        const now = Date.now();
        const minutesUntilRetry = Math.ceil((queueInfo.nextRetry - now) / 60000);
        if (minutesUntilRetry <= 0) return "Retrying now...";
        return `Next retry in ${minutesUntilRetry} minute${minutesUntilRetry !== 1 ? "s" : ""}`;
    };

    return (
        <Alert className="mb-4 border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
            <AlertTitle className="text-blue-900 dark:text-blue-100 flex items-center justify-between">
                <span>Sync Queue Active</span>
                {/* Manual retry button */}
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleManualRetry}
                    disabled={isRetrying}
                >
                    {isRetrying ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                        <RefreshCw className="h-3 w-3 mr-1" />
                    )}
                    Retry Now
                </Button>
            </AlertTitle>
            <AlertDescription className="text-sm text-blue-800 dark:text-blue-200">
                {queueInfo.count} submission{queueInfo.count !== 1 ? "s" : ""} waiting to sync to GitHub.{" "}
                {getRetryText()}
            </AlertDescription>
        </Alert>
    );
};

export default SyncQueueStatus;
