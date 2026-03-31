import GitHubSubmissionSync from "@components/github-submission-sync";
import ReportIssueButton from "@components/report-issue";
import PrivacyPolicyButton from "@components/privacy-policy";
import SubscriptionManagementCard from "@/components/subscription-management";
import GitHubRateLimitStatus from "@/components/github-rate-limit-status";
import SyncQueueStatus from "@/components/sync-queue-status";

const App = () => {
    return (
        <div className="min-h-screen flex items-center justify-center p-2">
            <div className="space-y-4 flex flex-col w-full max-w-lg">
                {/* Status indicators at the top */}
                <GitHubRateLimitStatus />
                <SyncQueueStatus />
                
                <GitHubSubmissionSync />
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
