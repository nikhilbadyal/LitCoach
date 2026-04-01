// Centralized error message handling with context-aware guidance
// Provides actionable next steps for users based on error type

/**
 * Get user-friendly error message and guidance based on error response
 * @param {Error} error - The error object from API call
 * @param {string} context - Context where error occurred (e.g., 'auth', 'repo_create', 'sync')
 * @returns {Object} - { title, description, action }
 */
export const getErrorMessage = (error, context = 'general') => {
    const status = error.response?.status;
    const errorDetail = error.response?.data?.detail || error.message || 'Unknown error';

    // Rate limiting errors
    if (status === 429 || errorDetail.includes('rate limit')) {
        return {
            title: 'GitHub Rate Limit Exceeded',
            description: 'You\'ve made too many requests to GitHub. Your submissions will be queued and synced automatically when the limit resets (usually within an hour).',
            action: 'Wait for rate limit to reset',
            variant: 'default',
        };
    }

    // Authentication errors
    if (status === 401) {
        return {
            title: 'Authentication Failed',
            description: 'Your GitHub token is invalid or expired. Please disconnect and reconnect your GitHub account.',
            action: 'Reconnect GitHub account',
            variant: 'destructive',
        };
    }

    // Permission errors
    if (status === 403) {
        if (errorDetail.includes('permission') || errorDetail.includes('access')) {
            return {
                title: 'Permission Denied',
                description: 'Your GitHub token doesn\'t have the required permissions. Make sure you granted "repo" access when connecting.',
                action: 'Reconnect with proper permissions',
                variant: 'destructive',
            };
        }
        // Could also be rate limit disguised as 403
        return {
            title: 'Access Denied',
            description: 'GitHub denied the request. This might be a rate limit or permission issue.',
            action: 'Check rate limit or reconnect account',
            variant: 'destructive',
        };
    }

    // Repository-specific errors
    if (context === 'repo_create') {
        if (status === 400 || errorDetail.includes('already exists')) {
            return {
                title: 'Repository Already Exists',
                description: 'A repository with this name already exists in your GitHub account. Choose a different name or select the existing repository.',
                action: 'Use different name',
                variant: 'default',
            };
        }
        if (status === 422) {
            return {
                title: 'Invalid Repository Name',
                description: 'The repository name contains invalid characters. Use only letters, numbers, hyphens, and underscores.',
                action: 'Fix repository name',
                variant: 'default',
            };
        }
    }

    // Sync-specific errors
    if (context === 'sync') {
        if (status === 409) {
            return {
                title: 'Submission Already Synced',
                description: 'This submission has already been synced to your repository. No action needed.',
                action: null,
                variant: 'default',
            };
        }
    }

    // Network errors
    if (!status || status >= 500) {
        return {
            title: 'Connection Error',
            description: 'Unable to reach the server. Check your internet connection. Your submission will be queued and retried automatically.',
            action: 'Check internet connection',
            variant: 'default',
        };
    }

    // Generic client errors
    if (status >= 400 && status < 500) {
        return {
            title: 'Request Failed',
            description: errorDetail || 'The request could not be completed. Please try again.',
            action: 'Try again',
            variant: 'destructive',
        };
    }

    // Fallback for unknown errors
    return {
        title: 'Something Went Wrong',
        description: errorDetail || 'An unexpected error occurred. Please try again or contact support if the issue persists.',
        action: 'Try again or contact support',
        variant: 'destructive',
    };
};

/**
 * Get troubleshooting link based on error type
 * @param {number} status - HTTP status code
 * @returns {string|null} - URL to troubleshooting docs or null
 */
export const getTroubleshootingLink = (status) => {
    if (status === 429) {
        return 'https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limiting';
    }
    if (status === 401 || status === 403) {
        return 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github';
    }
    return null;
};
