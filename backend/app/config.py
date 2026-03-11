from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    APP_NAME: str = "果管系统"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False

    DB_HOST: str = "36.134.229.82"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASS: str = "Amz24639."
    DB_NAME: str = "my_sk9"

    @property
    def DATABASE_URL(self) -> str:
        return f"mysql+pymysql://{self.DB_USER}:{self.DB_PASS}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset=utf8mb4"

    @property
    def ASYNC_DATABASE_URL(self) -> str:
        return f"mysql+aiomysql://{self.DB_USER}:{self.DB_PASS}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset=utf8mb4"

    JWT_SECRET: str = "qwe52030"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24
    JWT_REMEMBER_DAYS: int = 7

    REDIS_URL: str = "redis://localhost:6379/0"
    CACHE_TTL: int = 300

    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3001"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
