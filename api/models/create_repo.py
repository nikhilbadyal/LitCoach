from pydantic import BaseModel
from typing import Optional


class CreateRepo(BaseModel):
    user_id: Optional[str] = None
    repo_name: str
    github_access_token: Optional[str] = None
    is_private: bool = False
