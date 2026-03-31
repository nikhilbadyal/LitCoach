from pydantic import BaseModel
from typing import List, Optional
from enum import Enum


class Message(BaseModel):
    role: str
    content: str


class ResponseStyle(str, Enum):
    normal = "normal"
    concise = "concise"


class ModelName(str, Enum):
    gpt_4o = "gpt-4o"
    o3_mini = "o3-mini"
    llama_3_3_70b_versatile = "llama-3.3-70b-versatile"
    llama_3_1_8b_instant = "llama-3.1-8b-instant"
    gemini_2_5_pro = "gemini-2.5-pro"
    gemini_2_5_flash = "gemini-2.5-flash"


class AIAssistance(BaseModel):
    problem_description: str
    context: Optional[List[Message]]
    code: str
    prompt: str
    user_id: Optional[str] = None
    google_user_id: Optional[str] = None
    response_style: Optional[ResponseStyle] = ResponseStyle.concise
    model_name: Optional[ModelName] = ModelName.llama_3_3_70b_versatile
