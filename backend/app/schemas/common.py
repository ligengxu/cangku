from pydantic import BaseModel
from typing import Any, Generic, TypeVar
from datetime import date

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    success: bool = True
    message: str = "ok"
    data: T | None = None


class PaginatedResponse(BaseModel, Generic[T]):
    success: bool = True
    data: list[T] = []
    total: int = 0
    page: int = 1
    page_size: int = 20


class PageParams(BaseModel):
    page: int = 1
    page_size: int = 20
    sort_by: str | None = None
    sort_order: str = "desc"


class DateRangeParams(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
