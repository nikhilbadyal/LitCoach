import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription, AlertTitle } from "@components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/ui/select";
import { Switch } from "@components/ui/switch";
import { Button } from "@components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@components/ui/form";
import { Input } from "@components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@components/ui/avatar";
import { Skeleton } from "@components/ui/skeleton";
import { useToast } from "@hooks/use-toast";
import { Loader2, Settings2, Plus, GitPullRequestArrow, ExternalLink } from "lucide-react";
import { Label } from "@components/ui/label";
import DisconnectGitHubAccount from "@components/disconnect-github-account";
import { getErrorMessage, getTroubleshootingLink } from "@/utils/error-messages";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID;

const setChromeStorage = (data) => new Promise((resolve) => chrome.storage.sync.set(data, resolve));
const getChromeStorage = (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
const removeChromeStorage = (key) => new Promise((resolve) => chrome.storage.sync.remove(key, resolve));

const repoFormSchema = z.object({
    repoName: z
        .string()
        .min(1, "Repository name is required")
        .max(100, "Repository name must be less than 100 characters")
        .regex(/^[a-zA-Z0-9._-]+$/, {
            message: "Repository name can only contain letters, numbers, periods, hyphens, and underscores",
        }),
    isPrivate: z.boolean().default(false),
});

const GitHubSubmissionSync = () => {
    const { toast } = useToast();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isDataLoading, setIsDataLoading] = useState(true);
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [creatingRepo, setCreatingRepo] = useState(false);
    const [selectedRepo, setSelectedRepo] = useState({ id: null, name: "" });
    // Track the last successfully synced submission filename for display
    const [lastSynced, setLastSynced] = useState(null);
    const [userData, setUserData] = useState({
        githubAccessToken: "",
        githubName: "",
        avatarUrl: "",
        repos: [],
    });

    const form = useForm({
        resolver: zodResolver(repoFormSchema),
        defaultValues: { repoName: "", isPrivate: false },
    });

    // Check if user is authenticated with GitHub and fetch their data
    // This function is called on component mount and after successful OAuth
    const checkGitHubAuth = useCallback(async () => {
        console.log("[DEBUG] checkGitHubAuth called");
        try {
            setIsDataLoading(true);
            
            // Ask background script to verify authentication and fetch user data
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: "isGitHubAuthenticated" }, (res) => resolve(res));
            });

            setIsAuthenticated(response);

            if (response) {
                const { github_access_token, github_user_data, selected_repo_id, sync_enabled } =
                    await getChromeStorage([
                        "github_access_token",
                        "github_user_data",
                        "selected_repo_id",
                        "sync_enabled",
                    ]);

                // Guard against corrupted or missing storage data to prevent rendering crashes
                if (!github_user_data || !github_access_token) {
                    setIsAuthenticated(false);
                    return;
                }

                setUserData({
                    githubAccessToken: github_access_token,
                    githubName: github_user_data.github_name,
                    avatarUrl: github_user_data.avatar_url,
                    repos: github_user_data.repos || [],
                });

                setSyncEnabled(!!sync_enabled);

                if (selected_repo_id) {
                    const selected = github_user_data.repos?.find(
                        (repo) => repo.id.toString() === selected_repo_id.toString(),
                    );
                    if (selected) setSelectedRepo({ id: selected_repo_id, name: selected.name });
                }

                // Read the last successfully synced submission filename from local storage
                chrome.storage.local.get(["last_synced_file"], (result) => {
                    if (result.last_synced_file) setLastSynced(result.last_synced_file);
                });
            }
        } catch (error) {
            console.error("Authentication check failed", error);
            setIsAuthenticated(false);
        } finally {
            setIsDataLoading(false);
        }
    }, []);

    // Handle GitHub OAuth authentication flow
    // Clears old data, launches OAuth, saves token, and verifies it works
    const handleGitHubAuth = useCallback(async () => {
        setIsActionLoading(true);
        
        // Clear any existing GitHub data before starting fresh auth
        // This ensures clean state when switching accounts
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
        
        const redirectURL = chrome.identity.getRedirectURL();
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${redirectURL}&scope=read:user%20repo`;

        try {
            // Launch OAuth flow in browser
            const responseUrl = await new Promise((resolve, reject) => {
                chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (response) => {
                    if (chrome.runtime.lastError || !response) {
                        reject(new Error(chrome.runtime.lastError?.message || "Authentication failed"));
                    }
                    resolve(response);
                });
            });

            const code = new URLSearchParams(new URL(responseUrl).search).get("code");
            if (!code) throw new Error("No authorization code received");

            // Exchange authorization code for access token
            const { data } = await axios.post(`${API_URL}/github/access-token`, { code: code });
            await setChromeStorage({ github_access_token: data.github_access_token });

            // Verify the token works by fetching user data
            // Background script will check rate limits and cache the data
            const isAuthenticated = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: "isGitHubAuthenticated" }, (res) => resolve(res));
            });

            if (isAuthenticated) {
                // Successfully authenticated and fetched user data
                await checkGitHubAuth();
                toast({ 
                    title: "Authentication Success", 
                    description: "Successfully authenticated with GitHub" 
                });
            } else {
                // Token is valid but couldn't fetch user data (likely rate limited)
                // Check if we have cached data from a previous session
                const { github_user_data } = await getChromeStorage(["github_user_data"]);
                
                if (github_user_data) {
                    // We have cached data, use it
                    await checkGitHubAuth();
                    toast({
                        title: "Authentication Successful",
                        description: "Connected with GitHub. Using cached data due to rate limit.",
                        variant: "default",
                    });
                } else {
                    // No cached data available
                    toast({
                        title: "Authentication Successful, But...",
                        description: "GitHub rate limit exceeded. Your account is connected but data will load when the limit resets.",
                        variant: "default",
                    });
                }
            }
        } catch (error) {
            console.error("GitHub Auth failed", error);
            toast({
                title: "Authentication Failed",
                description: "Failed to authenticate with GitHub",
                variant: "destructive",
            });
        } finally {
            setIsActionLoading(false);
        }
    }, [checkGitHubAuth, toast]);

    const handleCreateRepo = async (values) => {
        try {
            setCreatingRepo(true);
            
            // Optimistically add repo to UI before API call
            const tempRepo = { id: `temp_${Date.now()}`, name: values.repoName };
            setUserData((prev) => ({
                ...prev,
                repos: [...prev.repos, tempRepo],
            }));
            setSelectedRepo(tempRepo);
            
            const response = await axios.post(`${API_URL}/user/github/repo`, {
                repo_name: values.repoName,
                github_access_token: userData.githubAccessToken,
                is_private: values.isPrivate,
            });

            // Replace temp repo with real repo data
            const newRepo = { id: response.data.repo_id, name: values.repoName };
            setUserData((prev) => ({
                ...prev,
                repos: prev.repos.map(r => r.id === tempRepo.id ? newRepo : r),
            }));
            setSelectedRepo(newRepo);
            await setChromeStorage({ selected_repo_id: newRepo.id });

            form.reset();
            toast({
                title: "Success",
                description: `Created and selected repository: ${values.repoName}`,
            });
        } catch (error) {
            console.error("Error creating repository", error);
            
            // Rollback optimistic update on error
            setUserData((prev) => ({
                ...prev,
                repos: prev.repos.filter(r => !r.id.toString().startsWith('temp_')),
            }));
            setSelectedRepo({ id: null, name: "" });
            
            // Use centralized error message handler
            const errorInfo = getErrorMessage(error, 'repo_create');
            const troubleshootingLink = getTroubleshootingLink(error.response?.status);
            
            toast({
                title: errorInfo.title,
                description: (
                    <div>
                        <p>{errorInfo.description}</p>
                        {troubleshootingLink && (
                            <a 
                                href={troubleshootingLink} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs underline mt-2 inline-block"
                            >
                                Learn more →
                            </a>
                        )}
                    </div>
                ),
                variant: errorInfo.variant,
            });
        } finally {
            setCreatingRepo(false);
        }
    };

    // Toggle sync on/off with optimistic UI update
    const handleToggleSync = async (checked) => {
        // Optimistically update UI immediately for better perceived performance
        setSyncEnabled(checked);
        
        try {
            await setChromeStorage({ sync_enabled: checked });

            // When re-enabling sync, only default to first repo if no repo was previously selected.
            // This preserves the user's repo choice across toggle cycles.
            if (checked && !selectedRepo.id && userData.repos.length > 0) {
                const firstRepo = userData.repos[0];
                await setChromeStorage({ selected_repo_id: firstRepo.id });
                setSelectedRepo({ id: firstRepo.id, name: firstRepo.name });
            }
        } catch (error) {
            // Rollback on error
            console.error("Failed to toggle sync", error);
            setSyncEnabled(!checked);
            toast({
                title: "Error",
                description: "Failed to update sync settings. Please try again.",
                variant: "destructive",
            });
        }
    };

    // Select repository with optimistic UI update
    const handleRepoSelect = async (repoId) => {
        const selected = userData.repos.find((repo) => repo.id.toString() === repoId.toString());
        
        // Optimistically update UI
        const previousRepo = selectedRepo;
        setSelectedRepo({ id: repoId, name: selected?.name || "" });
        
        try {
            await setChromeStorage({ selected_repo_id: repoId });
        } catch (error) {
            // Rollback on error
            console.error("Failed to select repo", error);
            setSelectedRepo(previousRepo);
            toast({
                title: "Error",
                description: "Failed to select repository. Please try again.",
                variant: "destructive",
            });
        }
    };

    useEffect(() => {
        checkGitHubAuth();
    }, [checkGitHubAuth]);

    if (isDataLoading) {
        return (
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between border-b border-gray-200 pb-3">
                        <div className="flex items-center space-x-3">
                            <Skeleton className="h-10 w-10 rounded-full" />
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-3 w-24" />
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-8 w-3/4" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (!isAuthenticated) {
        return (
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center">
                        <GitPullRequestArrow className="w-5 h-5 mr-2" />
                        Sync LeetCode with GitHub?
                    </CardTitle>
                    <CardDescription>
                        Connect your GitHub account to sync your successful LeetCode submissions to a GitHub
                        repository!
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button
                        onClick={handleGitHubAuth}
                        className="w-full"
                        size="sm"
                        variant="outline"
                        disabled={isActionLoading}
                    >
                        {isActionLoading ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                            <>
                                <img src="/github_octocat.svg" alt="GitHub Logo" className="h-4 w-4" />
                                Sign in with GitHub
                            </>
                        )}
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className={syncEnabled ? "pb-3" : "pb-5"}>
                <div className="flex items-center justify-between border-b border-gray-200 pb-3">
                    <div className="flex items-center space-x-3">
                        <Avatar>
                            <AvatarImage src={userData.avatarUrl} />
                            <AvatarFallback>{userData.githubName?.[0]}</AvatarFallback>
                        </Avatar>
                        <CardTitle>{userData.githubName}</CardTitle>
                    </div>
                    <div>
                        <DisconnectGitHubAccount />
                    </div>
                </div>
                <div className="flex items-center justify-between space-x-3 pt-1">
                    <div className="flex-1">
                        <p className="text-sm text-muted-foreground">
                            {syncEnabled
                                ? selectedRepo.id
                                    ? `Currently syncing with: ${selectedRepo.name}`
                                    : "Select or create a repository to start syncing"
                                : "Enable to start syncing LeetCode submissions to a GitHub repository"}
                        </p>
                        {/* Display the last successfully synced submission */}
                        {lastSynced && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                <span className="inline-block w-2 h-2 bg-green-500 rounded-full"></span>
                                Last synced: <span className="font-mono">{lastSynced}</span>
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {/* View on GitHub button */}
                        {syncEnabled && selectedRepo.id && userData.githubName && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8"
                                onClick={() => {
                                    window.open(`https://github.com/${userData.githubName}/${selectedRepo.name}`, "_blank");
                                }}
                                title="View repository on GitHub"
                            >
                                <ExternalLink className="h-4 w-4" />
                            </Button>
                        )}
                        <Switch checked={syncEnabled} onCheckedChange={handleToggleSync} />
                    </div>
                </div>
            </CardHeader>

            {syncEnabled && (
                <CardContent>
                    <Tabs defaultValue={userData.repos.length > 0 ? "select" : "create"}>
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="select">
                                <Settings2 className="w-4 h-4 mr-2" />
                                Select Repo
                            </TabsTrigger>
                            <TabsTrigger value="create">
                                <Plus className="w-4 h-4 mr-2" />
                                New Repo
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="select" className="mt-4">
                            {userData.repos.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-6 text-center border-2 border-dashed rounded-lg bg-muted/50 border-muted-foreground/20">
                                    <p className="text-sm font-medium text-foreground mb-1">No repositories found</p>
                                    <p className="text-xs text-muted-foreground max-w-[200px]">
                                        Switch to the <span className="font-semibold text-foreground">New Repo</span> tab to get started.
                                    </p>
                                </div>
                            ) : (
                                <Select value={selectedRepo.id?.toString()} onValueChange={handleRepoSelect}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={selectedRepo.name || "Choose a repository"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {userData.repos.map(({ id, name }) => (
                                            <SelectItem key={id} value={id.toString()}>
                                                {name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </TabsContent>

                        <TabsContent value="create" className="mt-4">
                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(handleCreateRepo)} className="space-y-4">
                                    <FormField
                                        control={form.control}
                                        name="repoName"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <Input
                                                        placeholder="Enter repository name"
                                                        disabled={creatingRepo}
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="isPrivate"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center justify-between space-y-0 rounded-lg border p-3">
                                                <div className="space-y-0.5">
                                                    <Label className="text-sm font-medium">Private Repository</Label>
                                                    <p className="text-xs text-muted-foreground">
                                                        Make this repository private
                                                    </p>
                                                </div>
                                                <FormControl>
                                                    <Switch
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                        disabled={creatingRepo}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <Button
                                        type="submit"
                                        variant="outline"
                                        disabled={creatingRepo}
                                        className="w-full"
                                    >
                                        {creatingRepo ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <>
                                                <Plus className="h-4 w-4" />
                                                Create Repository
                                            </>
                                        )}
                                    </Button>
                                </form>
                            </Form>
                        </TabsContent>
                    </Tabs>
                </CardContent>
            )}
        </Card>
    );
};

export default GitHubSubmissionSync;
