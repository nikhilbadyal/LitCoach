import GitHubSubmissionSync from "@components/github-submission-sync";
import ReportIssueButton from "@components/report-issue";
import PrivacyPolicyButton from "@components/privacy-policy";
import SubscriptionManagementCard from "@/components/subscription-management";
import GitHubRateLimitStatus from "@/components/github-rate-limit-status";
import SyncQueueStatus from "@/components/sync-queue-status";
import SyncHistory from "@/components/sync-history";
// ThemeProvider has been lifted to main.jsx so all screens respect dark mode
import { ThemeToggle } from "@/components/theme-toggle";

const App = () => {
    return (
            /* bg-background ensures the options page respects the dark/light theme */
            <div className="min-h-screen flex items-center justify-center p-2 bg-background">
                <div className="space-y-4 flex flex-col w-full max-w-lg">
                    {/* Theme toggle in top right */}
                    <div className="flex justify-end">
                        <ThemeToggle />
                    </div>
                    
                    {/* Status indicators at the top */}
                    <GitHubRateLimitStatus />
                    <SyncQueueStatus />
                    
                    <GitHubSubmissionSync />
                    
                    {/* Sync history - shows recent activity */}
                    <SyncHistory />
                    
                    {/* <SubscriptionCard /> */}
                    <SubscriptionManagementCard />
                    <div className="mx-auto">
                        <ReportIssueButton />
                        <PrivacyPolicyButton />
                    </div>
                </div>
            </div>
    );
};

export default App;
