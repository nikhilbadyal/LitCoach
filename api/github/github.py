import requests
from fastapi.exceptions import HTTPException
import base64
from typing import List
from api.config import settings


def resolve_github_access_token(code: str) -> str:
    url = "https://github.com/login/oauth/access_token"
    headers = {"Accept": "application/json"}
    data = {
        "client_id": settings.GITHUB_CLIENT_ID,
        "client_secret": settings.GITHUB_CLIENT_SECRET,
        "code": code,
    }

    try:
        response = requests.post(url, headers=headers, data=data)
        response.raise_for_status()
        access_token = response.json().get("access_token")

        if not access_token:
            error_description = response.json().get(
                "error_description", "Unknown error"
            )
            raise HTTPException(
                status_code=400,
                detail=f"Error getting access token: {error_description}",
            )

        return access_token
    except requests.RequestException as e:
        raise HTTPException(
            status_code=getattr(e.response, "status_code", 500),
            detail=f"Request to GitHub failed: {str(e)}",
        )


def get_user_info_from_github(access_token: str) -> dict:
    url = "https://api.github.com/user"
    headers = {"Authorization": f"token {access_token}"}

    # Log the API call
    from api.config import logger
    logger.info(f"Making GitHub API call to: {url}")

    try:
        response = requests.get(url, headers=headers)
        
        # Log rate limit info from response headers
        rate_limit_remaining = response.headers.get("X-RateLimit-Remaining", "unknown")
        rate_limit_limit = response.headers.get("X-RateLimit-Limit", "unknown")
        rate_limit_reset = response.headers.get("X-RateLimit-Reset", "unknown")
        logger.info(f"GitHub API Rate Limit: {rate_limit_remaining}/{rate_limit_limit} remaining (resets at {rate_limit_reset})")
        
        # Check for rate limit error and provide helpful message
        if response.status_code == 403:
            if rate_limit_remaining == "0":
                raise HTTPException(
                    status_code=429,
                    detail=f"GitHub API rate limit exceeded. Resets at timestamp: {rate_limit_reset}",
                )
        
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        raise HTTPException(
            status_code=getattr(e.response, "status_code", 500),
            detail=f"Error fetching GitHub user info: {str(e)}",
        )


def get_user_github_repos(access_token: str) -> List[dict]:
    url = "https://api.github.com/user/repos"
    headers = {"Authorization": f"token {access_token}"}
    params = {"affiliation": "owner", "per_page": 100}

    # Log the API call
    from api.config import logger
    logger.info(f"Making GitHub API call to: {url}")

    try:
        repos = []
        page = 1
        while True:
            logger.info(f"Fetching repos page {page}")
            response = requests.get(
                url, headers=headers, params={**params, "page": page}
            )
            
            # Log rate limit info from response headers
            rate_limit_remaining = response.headers.get("X-RateLimit-Remaining", "unknown")
            rate_limit_limit = response.headers.get("X-RateLimit-Limit", "unknown")
            rate_limit_reset = response.headers.get("X-RateLimit-Reset", "unknown")
            logger.info(f"GitHub API Rate Limit: {rate_limit_remaining}/{rate_limit_limit} remaining (resets at {rate_limit_reset})")
            
            # Check for rate limit error and provide helpful message
            if response.status_code == 403:
                if rate_limit_remaining == "0":
                    raise HTTPException(
                        status_code=429,
                        detail=f"GitHub API rate limit exceeded. Resets at timestamp: {rate_limit_reset}",
                    )
            
            response.raise_for_status()
            page_repos = response.json()

            if not page_repos:
                break

            repos.extend(page_repos)
            page += 1
            
            # Safety check to prevent infinite loops
            if page > 100:
                logger.warning(f"Stopped fetching repos after 100 pages (10,000 repos)")
                break

        logger.info(f"Total repos fetched: {len(repos)}")
        return repos
    except requests.RequestException as e:
        # Provide more specific error message for authentication failures
        status_code = getattr(e.response, "status_code", 500)
        if status_code == 401:
            raise HTTPException(
                status_code=401,
                detail="GitHub authentication failed. Your access token may have expired or been revoked. Please re-authenticate with GitHub.",
            )
        raise HTTPException(
            status_code=status_code,
            detail=f"Error fetching user's GitHub repositories: {str(e)}",
        )


def resolve_github_repo_id_to_repo_name(repo_id: int, access_token: str) -> dict:
    # Log the API call
    from api.config import logger
    logger.info(f"Resolving repo ID {repo_id} to repo name (calls get_user_github_repos)")
    
    repos = get_user_github_repos(access_token=access_token)

    for repo in repos:
        if repo.get("id") == repo_id:
            return {
                "name": repo.get("name"),
                "owner": repo.get("owner").get("login"),
            }

    return None


def push_to_github(
    file_path: str,
    content: str,
    commit_message: str,
    owner_name: str,
    repo_name: str,
    access_token: str,
) -> None:
    url = f"https://api.github.com/repos/{owner_name}/{repo_name}/contents/{file_path}"
    headers = {"Authorization": f"token {access_token}"}
    data = {
        "message": commit_message,
        "content": base64.b64encode(content.encode()).decode("utf-8"),
        "branch": "main",
    }

    # Log the API call
    from api.config import logger
    logger.info(f"Making GitHub API call to: {url} (GET to check if file exists)")

    response = requests.get(url, headers=headers)
    
    # Log rate limit after GET
    rate_limit_remaining = response.headers.get("X-RateLimit-Remaining", "unknown")
    rate_limit_limit = response.headers.get("X-RateLimit-Limit", "unknown")
    logger.info(f"GitHub API Rate Limit after GET: {rate_limit_remaining}/{rate_limit_limit} remaining")
    
    sha = response.json().get("sha", None)

    if sha:
        existing_content = base64.b64decode(response.json().get("content")).decode(
            "utf-8"
        )
        if existing_content == content:
            logger.info("Content unchanged, skipping push")
            return
        data["sha"] = sha

    try:
        logger.info(f"Making GitHub API call to: {url} (PUT to push content)")
        response = requests.put(url, json=data, headers=headers)
        
        # Log rate limit after PUT
        rate_limit_remaining = response.headers.get("X-RateLimit-Remaining", "unknown")
        rate_limit_limit = response.headers.get("X-RateLimit-Limit", "unknown")
        logger.info(f"GitHub API Rate Limit after PUT: {rate_limit_remaining}/{rate_limit_limit} remaining")
        
        response.raise_for_status()
    except requests.RequestException as e:
        raise HTTPException(
            status_code=getattr(e.response, "status_code", 500),
            detail=f"Error pushing to GitHub: {str(e)}",
        )


def create_github_repo(repo_name: str, access_token: str, tags: List[str]) -> int:
    url = "https://api.github.com/user/repos"
    headers = {
        "Authorization": f"token {access_token}",
        "Accept": "application/vnd.github.v3+json",
    }
    data = {
        "name": repo_name,
        "description": "Collection of successful LeetCode submissions - automatically synced using LitCoach",
        "homepage": "https://chromewebstore.google.com/detail/litcoach/pbkbbpmpbidfjbcapgplbdogiljdechf",
        "private": False,
        "auto_init": True,
    }

    # Log the API call
    from api.config import logger
    logger.info(f"Checking if repo '{repo_name}' already exists (calls get_user_github_repos)")
    
    repo_names = [
        repo.get("name") for repo in get_user_github_repos(access_token=access_token)
    ]
    if repo_name in repo_names:
        raise HTTPException(
            status_code=400,
            detail="Repository with the same name already exists",
        )

    try:
        logger.info(f"Making GitHub API call to: {url} (POST to create repo)")
        response = requests.post(url, headers=headers, json=data)
        
        # Log rate limit after POST
        rate_limit_remaining = response.headers.get("X-RateLimit-Remaining", "unknown")
        rate_limit_limit = response.headers.get("X-RateLimit-Limit", "unknown")
        logger.info(f"GitHub API Rate Limit after POST: {rate_limit_remaining}/{rate_limit_limit} remaining")
        
        response.raise_for_status()
        repo_info = response.json()
        repo_id = repo_info.get("id")
        if tags:
            tags_url = f"https://api.github.com/repos/{response.json().get('owner').get('login')}/{repo_name}/topics"
            tags_headers = {
                "Authorization": f"token {access_token}",
                "Accept": "application/vnd.github.mercy-preview+json",
            }
            tags_data = {"names": tags}
            
            logger.info(f"Making GitHub API call to: {tags_url} (PUT to add topics)")
            tags_response = requests.put(tags_url, headers=tags_headers, json=tags_data)
            
            # Log rate limit after topics PUT
            rate_limit_remaining = tags_response.headers.get("X-RateLimit-Remaining", "unknown")
            rate_limit_limit = tags_response.headers.get("X-RateLimit-Limit", "unknown")
            logger.info(f"GitHub API Rate Limit after topics PUT: {rate_limit_remaining}/{rate_limit_limit} remaining")
            
            tags_response.raise_for_status()

        return repo_id
    except requests.RequestException as e:
        raise HTTPException(
            status_code=getattr(e.response, "status_code", 500),
            detail=f"Error creating GitHub repo: {str(e)}",
        )
