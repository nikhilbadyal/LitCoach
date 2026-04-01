import { useState } from "react";
import { Button } from "@components/ui/button";
import { ExternalLink, Unplug, Loader2 } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@components/ui/hover-card";

// Link to GitHub's official guide for fully revoking OAuth app access
const GITHUB_OAUTH_REMOVAL_GUIDE =
    "https://docs.github.com/en/apps/oauth-apps/maintaining-oauth-apps/deleting-an-oauth-app";

function DisconnectGitHubAccount() {
    // Track the disconnect action to show a loading spinner
    const [isDisconnecting, setIsDisconnecting] = useState(false);

    // Clear all GitHub-related data from extension storage and reload the page
    const handleDisconnect = async () => {
        setIsDisconnecting(true);
        
        // Clear all sync storage (persistent across sessions)
        await new Promise((resolve) =>
            chrome.storage.sync.remove(
                [
                    "github_access_token",
                    "github_user_data",
                    "github_data_cache_time",
                    "selected_repo_id",
                    "sync_enabled"
                ],
                resolve,
            ),
        );
        
        // Clear all local storage (session data)
        await new Promise((resolve) =>
            chrome.storage.local.remove(
                [
                    "github_rate_limit",
                    "sync_queue",
                    "last_sync_status",
                    "last_synced_file"
                ],
                resolve,
            ),
        );
        
        // Clear any processing flags (they start with "processing_")
        chrome.storage.local.get(null, (items) => {
            const processingKeys = Object.keys(items).filter(key => key.startsWith("processing_"));
            if (processingKeys.length > 0) {
                chrome.storage.local.remove(processingKeys);
            }
        });
        
        // Reload so the GitHub sync card resets to the "Sign in" state
        window.location.reload();
    };

    return (
        <HoverCard>
            <HoverCardTrigger>
                <Button variant="link" className="font-light text-xs" disabled={isDisconnecting}>
                    {isDisconnecting ? <Loader2 className="animate-spin" /> : <Unplug />}
                    {isDisconnecting ? "Disconnecting..." : "Disconnect Account?"}
                </Button>
            </HoverCardTrigger>
            <HoverCardContent className="w-80">
                <div className="space-y-2">
                    <p className="text-sm">Want to disconnect your account?</p>
                    <p className="text-xs text-muted-foreground">
                        This will clear your GitHub token from the extension. To also revoke
                        LitCoach&apos;s access on GitHub itself, visit the guide below.
                    </p>
                    {/* Actually disconnect by clearing the stored token */}
                    <Button
                        size="sm"
                        variant="destructive"
                        className="w-full text-xs"
                        onClick={handleDisconnect}
                        disabled={isDisconnecting}
                    >
                        Disconnect Now
                    </Button>
                    <Button
                        size="small"
                        variant="link"
                        className="text-xs font-light"
                        onClick={() => window.open(GITHUB_OAUTH_REMOVAL_GUIDE, "_blank")}
                    >
                        <ExternalLink />
                        GitHub OAuth Removal Guide
                    </Button>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}

export default DisconnectGitHubAccount;
