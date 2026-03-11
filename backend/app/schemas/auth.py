from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str
    remember: bool = False


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: "UserInfo"


class UserInfo(BaseModel):
    user_id: int
    username: str
    role: str
    real_name: str | None = None

    class Config:
        from_attributes = True


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class ProfileUpdate(BaseModel):
    real_name: str | None = None
    phone: str | None = None
    alipay_account: str | None = None


class ProfileOut(BaseModel):
    user_id: int
    username: str
    role: str
    real_name: str | None = None
    phone: str | None = None
    alipay_account: str | None = None
    created_stats: dict | None = None

    class Config:
        from_attributes = True
