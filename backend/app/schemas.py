from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class ChatRequest(BaseModel):
    text: str = Field(min_length=2, max_length=2000)
    use_ai: bool = True
    survivor_id: str | None = Field(default=None, max_length=100)
    location: Location | None = None
    share_location: bool = False
    group_id: str | None = Field(default=None, max_length=100)
    visibility: Literal["group", "responders", "public"] | None = None
    materials: list[str] = Field(default_factory=list)
    breathing: bool | None = None
    bleeding_type: str | None = None


class AssessRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    materials: list[str] = Field(default_factory=list)
    breathing: bool = True
    bleeding_type: str = "none"
    limit: int = Field(default=5, ge=1, le=20)



class ReportRequest(BaseModel):
    kind: Literal["incident", "hazard", "resource", "checkpoint", "sos"]
    text: str = Field(min_length=3, max_length=2000)
    reporter_id: str = Field(min_length=1, max_length=100)
    location: Location | None = None
    group_id: str | None = Field(default=None, max_length=100)
    visibility: Literal["public", "group", "responders"] | None = None
    entity_id: str | None = Field(default=None, max_length=100)
    status: str | None = Field(default=None, max_length=80)
    severity: Literal["red", "yellow", "green"] = "yellow"
    observed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    idempotency_key: str | None = Field(default=None, max_length=100)
    verified: bool = False
    supersedes_id: str | None = Field(default=None, max_length=64)

    @field_validator("observed_at")
    @classmethod
    def utc_time(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("observed_at requires a timezone")
        return value.astimezone(timezone.utc)


class NearbyRequest(BaseModel):
    location: Location
    radius_m: float = Field(default=2000, gt=0, le=50000)
    kinds: list[str] = Field(default_factory=lambda: ["presence", "incident", "hazard", "resource", "checkpoint", "sos"])
    group_id: str | None = None
    include_responders: bool = False


class CreateGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class JoinGroupRequest(BaseModel):
    group_id: str
    name: str
    token: str


class PeerSyncRequest(BaseModel):
    peer_url: str
    group_id: str | None = None
    responder: bool = False


class GuidePublishRequest(BaseModel):
    id: str = Field(min_length=3, max_length=100)
    title: str = Field(min_length=3, max_length=160)
    keywords: str = Field(min_length=3, max_length=500)
    summary: str = Field(min_length=10, max_length=1200)
    steps: list[str] = Field(min_length=1, max_length=10)
    warnings: list[str] = Field(default_factory=list, max_length=10)
    source: str = Field(pattern=r"^https://", max_length=500)
    reviewer: str = Field(min_length=2, max_length=100)


class RecommendAlternativeRequest(BaseModel):
    compromised_id: str = Field(min_length=1, max_length=100)
    avoid_hazard: str = Field(default="flooded entrance live wires", max_length=500)


class DeviceLocationUpdate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    status: str = Field(default="active", max_length=50)
    battery: int | None = Field(default=None, ge=0, le=100)
    node_id: str | None = Field(default=None, max_length=100)
    role: str | None = Field(default="survivor", max_length=50)
    device_name: str | None = Field(default=None, max_length=100)


class DiscoverySyncRequest(BaseModel):
    peer_url: str
    scope: Literal["public", "group", "responders"] = "public"
    group_id: str | None = None


class SurvivalRadarRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    radius_m: float = Field(default=3500.0, gt=0, le=50000.0)
    filter_category: Literal["all", "casualties", "shelters", "resources", "hazards", "peers"] = "all"
    group_id: str | None = None
    include_responders: bool = True


