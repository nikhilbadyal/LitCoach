import { useState, useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@components/ui/alert";
import { Loader2, CheckCircle, Clock } from "lucide-react";

// Component to show pending sync queue status
const SyncQueueStatus = () => {
    const [queueInfo, setQueueInfo] = useState({ count: 0, nextRetry: null });

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

    if (queueInfo.count === 0) return null;

    const getRetryText = () => {
        if (!queueInfo.nextRetry) return "Retrying soon...";
        const now = Date.now();
        const minutesUntilRetry = Math.ceil((queueInfo.nextRetry - now) / 60000);
        if (minutesUntilRetry <= 0) return "Retrying now...";
        return `Next retry in ${minutesUntilRetry} minute${minutesUntilRetry !== 1 ? "s" : ""}`;
    };

    return (
        <Alert className="mb-4 border-blue-200 bg-blue-50">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <AlertTitle className="text-blue-900">Sync Queue Active</AlertTitle>
            <AlertDescription className="text-sm text-blue-800">
                {queueInfo.count} submission{queueInfo.count !== 1 ? "s" : ""} waiting to sync to GitHub.{" "}
                {getRetryText()}
            </AlertDescription>
        </Alert>
    );
};

export default SyncQueueStatus;
