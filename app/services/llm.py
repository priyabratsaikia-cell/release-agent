"""Gemini LLM service – thin wrapper around langchain-google-genai."""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI

logger = logging.getLogger(__name__)


def get_llm(api_key: str, model: str = "gemini-3.1-pro-preview") -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model=model,
        google_api_key=api_key,
        temperature=0.2,
        max_output_tokens=65_536,
        convert_system_message_to_human=True,
    )


async def invoke_llm(
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    *,
    temperature: float = 0.2,
) -> str:
    llm = ChatGoogleGenerativeAI(
        model=model,
        google_api_key=api_key,
        temperature=temperature,
        max_output_tokens=65_536,
        convert_system_message_to_human=True,
    )
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]
    response = await llm.ainvoke(messages)
    return str(response.content)


async def invoke_llm_structured(
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    *,
    temperature: float = 0.1,
) -> str:
    """Same as invoke_llm but with lower temperature for structured outputs."""
    return await invoke_llm(
        api_key, model, system_prompt, user_prompt, temperature=temperature
    )
