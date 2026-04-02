// Component to display recent GitHub sync activity
// Shows last 10 synced submissions with timestamps and status

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { Button } from "@components/ui/button";
import { ScrollArea } from "@components/ui/scroll-area";
import { CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@components/ui/collapsible";

const SyncHistory = () => {
    const [history, setHistory] = useState([]);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        // Load sync history from local storage
        chrome.storage.local.get(["sync_history"], (result) => {
            if (result.sync_history) {
                setHistory(result.sync_history);
            }
        });

        // Listen for new sync events
        const handleStorageChange = (changes, area) => {
            if (area === "local" && changes.sync_history) {
                setHistory(changes.sync_history.newValue || []);
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);
        return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }, []);

    if (history.length === 0) return null;

    // Format timestamp to relative time (e.g., "2 minutes ago")
    const formatTimestamp = (timestamp) => {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return "Just now";
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
    };

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <Card>
                <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-base">Recent Sync Activity</CardTitle>
                                <CardDescription className="text-xs">
                                    Last {Math.min(history.length, 10)} synced submissions
                                </CardDescription>
                            </div>
                            <Button variant="ghost" size="sm">
                                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                        </div>
                    </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <CardContent>
                        <ScrollArea className="h-[200px] pr-4">
                            <div className="space-y-2">
                                {history.slice(0, 10).map((item, index) => (
                                    <div
                                        key={index}
                                        className="flex items-start justify-between p-2 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                                    >
                                        <div className="flex items-start gap-2 flex-1 min-w-0">
                                            {/* Status icon */}
                                            {item.status === "success" ? (
                                                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                            ) : item.status === "error" ? (
                                                <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                                            ) : (
                                                <Clock className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                                            )}
                                            
                                            {/* Problem info */}
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate" title={item.problemTitle || item.problemSlug}>
                                                    {item.problemTitle || item.problemSlug}
                                                </p>
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                    <span className="font-mono">{item.language}</span>
                                                    <span>•</span>
                                                    <span>{formatTimestamp(item.timestamp)}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* View on GitHub link */}
                                        {item.status === "success" && item.repoName && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 p-0 flex-shrink-0"
                                                onClick={() => {
                                                    const url = `https://github.com/${item.githubUsername}/${item.repoName}/blob/main/${item.problemSlug}/${item.language}`;
                                                    window.open(url, "_blank");
                                                }}
                                                title="View on GitHub"
                                            >
                                                <ExternalLink className="h-3 w-3" />
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </CollapsibleContent>
            </Card>
        </Collapsible>
    );
};

export default SyncHistory;
