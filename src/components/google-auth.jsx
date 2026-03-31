import { useState, useEffect, useCallback } from "react";
import { Button } from "@components/ui/button";
import { Loader2 } from "lucide-react";
import ReportIssueButton from "@components/report-issue";
import PrivacyPolicyButton from "@components/privacy-policy";
import { useToast } from "@hooks/use-toast";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const googleWebAuthLogin = () =>
    new Promise((resolve, reject) => {
        const manifest = chrome.runtime.getManifest();
        const clientId = manifest.oauth2?.client_id;

        if (!clientId) {
            return reject(new Error("OAuth2 client_id not found in manifest"));
        }

        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        // Chrome automatically generates the correct chromiumapp.org URL
        const redirectUri = chrome.identity.getRedirectURL();

        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_type", "token");
        authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email");
        authUrl.searchParams.set("prompt", "select_account");

        chrome.identity.launchWebAuthFlow(
            {
                url: authUrl.href,
                interactive: true,
            },
            async (redirectUrl) => {
                if (chrome.runtime.lastError || !redirectUrl) {
                    return reject(chrome.runtime.lastError || new Error("Auth flow failed"));
                }

                try {
                    // Extract token from URL hash fragment
                    const hash = new URL(redirectUrl).hash.substring(1);
                    const params = new URLSearchParams(hash);
                    const accessToken = params.get("access_token");

                    if (!accessToken) {
                        return reject(new Error("No access token found in redirect URL"));
                    }

                    // Fetch profile info returning { sub, email, name ... }
                    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                        },
                    });

                    if (!response.ok) {
                        return reject(new Error("Failed to fetch user profile from Google API"));
                    }

                    const userInfo = await response.json();
                    
                    if (!userInfo.sub) {
                        return reject(new Error("Google did not return a user ID (sub)"));
                    }

                    // Resolve mapping 'sub' to 'id' to be backwards compatible with the codebase
                    resolve({ id: userInfo.sub, email: userInfo.email });
                } catch (err) {
                    reject(err);
                }
            }
        );
    });

const storeGoogleUserID = (googleUserId) =>
    new Promise((resolve) => {
        chrome.storage.sync.set({ google_user_id: googleUserId }, () => resolve());
    });

const getStoredGoogleUserID = () =>
    new Promise((resolve) => {
        chrome.storage.sync.get(["google_user_id"], (result) => resolve(result.google_user_id));
    });

const getStoredLegacyID = () =>
    new Promise((resolve) => {
        chrome.storage.sync.get(["user_id"], (result) => resolve(result.user_id));
    });

const removeStoredLegacyID = () =>
    new Promise((resolve) => {
        chrome.storage.sync.remove(["user_id"], () => resolve());
    });

export const GoogleAuth = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const handleGoogleAuth = useCallback(async (interactive = false) => {
        setIsLoading(true);

        const storedGoogleUserId = await getStoredGoogleUserID();
        const storedUserId = await getStoredLegacyID();

        if (storedGoogleUserId && !interactive) {
            try {
                // Background check to ensure they are registered in the local DB
                await axios.post(`${API_URL}/user/register`, {
                    google_user_id: storedGoogleUserId,
                    old_user_id: storedUserId || null,
                });
            } catch (e) {
                // If it fails, silent ignore, they are probably still registered, database might be down
            }
            setIsAuthenticated(true);
            setIsLoading(false);
            return;
        }

        let googleInfo = null;
        try {
            googleInfo = await googleWebAuthLogin();
        } catch (error) {
            console.error("Authentication failed:", error);
            if (interactive) {
                toast({
                    title: "Authentication Failed",
                    description: "Could not sign in with Google. Try again.",
                    variant: "destructive",
                });
            }
            setIsLoading(false);
            return;
        }

        const googleUserId = googleInfo.id;

        if (googleUserId && googleUserId === storedGoogleUserId) {
            setIsAuthenticated(true);
            setIsLoading(false);
            return;
        }

        try {
            await axios.post(`${API_URL}/user/register`, {
                google_user_id: googleUserId,
                old_user_id: storedUserId || null,
            });

            await storeGoogleUserID(googleUserId);
            if (storedUserId) {
                await removeStoredLegacyID();
            }
            setIsAuthenticated(true);
        } catch (err) {
            console.error("Authentication error:", err);
            toast({
                title: "Authentication Failed",
                description: "Could not register user. Try again manually.",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        handleGoogleAuth(false);
    }, [handleGoogleAuth]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-4">
                <Loader2 className="animate-spin h-8 w-8" />
                <p className="text-sm font-light text-muted-foreground mt-2">Getting everything ready...</p>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="flex flex-col h-screen items-center justify-center space-y-3 p-4 text-center max-w-sm mx-auto">
                <h2 className="text-2xl font-semibold text-foreground">Authentication Required</h2>
                <p className="text-sm text-muted-foreground">Authenticate with Google to use this extension</p>

                <Button onClick={() => handleGoogleAuth(true)} className="w-full" variant="outline">
                    <img src="/google.svg" alt="Google Logo" className="mr-1 h-4 w-4" />
                    Sign in with Google
                </Button>
                <div>
                    <PrivacyPolicyButton />
                    <ReportIssueButton />
                </div>
            </div>
        );
    }

    return children;
};
