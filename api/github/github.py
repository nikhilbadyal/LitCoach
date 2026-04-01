import requests
from fastapi.exceptions import HTTPException
import base64
from typing import List

from api.config import logger, settings


def _log_github_response(method: str, url: str, response: requests.Response) -> None:
    """Log each GitHub HTTP response with rate-limit headers (REST + OAuth)."""
    h = response.headers
    logger.info(
        "GitHub HTTP %s %s -> status=%s | "
        "X-RateLimit-Limit=%s X-RateLimit-Remaining=%s X-RateLimit-Used=%s "
        "X-RateLimit-Reset=%s X-RateLimit-Resource=%s Retry-After=%s",
        method,
        url,
        response.status_code,
        h.get("X-RateLimit-Limit", "-"),
        h.get("X-RateLimit-Remaining", "-"),
        h.get("X-RateLimit-Used", "-"),
        h.get("X-RateLimit-Reset", "-"),
        h.get("X-RateLimit-Resource", "-"),
        h.get("Retry-After", "-"),
    )


def resolve_github_access_token(code: str) -> str:
    url = "https://github.com/login/oauth/access_token"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json"
    }
    data = {
        "client_id": settings.GITHUB_CLIENT_ID,
        "client_secret": settings.GITHUB_CLIENT_SECRET,
        "code": code,
    }

    try:
        response = requests.post(url, headers=headers, json=data)
        _log_github_response("POST", url, response)
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

    try:
        response = requests.get(url, headers=headers)
        _log_github_response("GET", url, response)

        if response.status_code in [403, 429]:
            rate_limit_remaining = response.headers.get("X-RateLimit-Remaining", "unknown")
            if rate_limit_remaining == "0":
                rate_limit_reset = response.headers.get("X-RateLimit-Reset", "unknown")
                raise HTTPException(
                    status_code=429,
                    detail=f"GitHub API rate limit exceeded. Resets at timestamp: {rate_limit_reset}",
                )
        
        if response.status_code == 401:
            raise HTTPException(
                status_code=401,
                detail="GitHub authentication failed. Your access token may have expired or been revoked. Please re-authenticate with GitHub.",
            )
        
        response.raise_for_status()
        return response.json()
    except HTTPException:
        raise
    except requests.RequestException as e:
        raise HTTPException(
            status_code=getattr(e.response, "status_code", 500),
            detail=f"Error fetching GitHub user info: {str(e)}",
        )


def get_user_github_repos(access_token: str) -> List[dict]:
    url = "https://api.github.com/user/repos"
    headers = {"Authorization": f"token {access_token}"}
    params = {"affiliation": "owner", "per_page": 100}

    try:
        repos = []
        page = 1
        while True:
            response = requests.get(
                url, headers=headers, params={**params, "page": page}
            )
            _log_github_response("GET", f"{url}?page={page}", response)

            if response.status_code in [403, 429]:
                rate_limit_remaining = response.headers.get("X-RateLimit-Remaining", "unknown")
                if rate_limit_remaining == "0":
                    rate_limit_reset = response.headers.get("X-RateLimit-Reset", "unknown")
                    raise HTTPException(
                        status_code=429,
                        detail=f"GitHub API rate limit exceeded. Resets at timestamp: {rate_limit_reset}",
                    )
            
            if response.status_code == 401:
                raise HTTPException(
                    status_code=401,
                    detail="GitHub authentication failed. Your access token may have expired or been revoked. Please re-authenticate with GitHub.",
                )
            
            response.raise_for_status()
            page_repos = response.json()

            if not page_repos:
                break

            repos.extend(page_repos)
            page += 1
            
            if page > 100:
                break

        return repos
    except HTTPException:
        raise
    except requests.RequestException as e:
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

    response = requests.get(url, headers=headers)
    _log_github_response("GET", url, response)
    sha = response.json().get("sha", None)

    if sha:
        existing_content = base64.b64decode(response.json().get("content")).decode(
            "utf-8"
        )
        if existing_content == content:
            return
        data["sha"] = sha

    try:
        response = requests.put(url, json=data, headers=headers)
        _log_github_response("PUT", url, response)
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

    repo_names = [
        repo.get("name") for repo in get_user_github_repos(access_token=access_token)
    ]
    if repo_name in repo_names:
        raise HTTPException(
            status_code=400,
            detail="Repository with the same name already exists",
        )

    try:
        response = requests.post(url, headers=headers, json=data)
        _log_github_response("POST", url, response)
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
            tags_response = requests.put(tags_url, headers=tags_headers, json=tags_data)
            _log_github_response("PUT", tags_url, tags_response)
            tags_response.raise_for_status()

        return repo_id
    except requests.RequestException as e:
        raise HTTPException(
            status_code=getattr(e.response, "status_code", 500),
            detail=f"Error creating GitHub repo: {str(e)}",
        )
