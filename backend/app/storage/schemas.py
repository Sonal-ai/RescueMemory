from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class GeoCoordinate(BaseModel):
    lat: float
    lon: float

class SurvivalProtocol(BaseModel):
    id: str
    title: str
    category: str  # e.g., "hemorrhage", "cpr", "water", "venom", "hypothermia"
    trigger_symptoms: List[str]
    required_materials: List[str]
    steps: List[str]
    warnings: List[str]
    cpr_cadence_required: bool = False
    priority: str = "immediate"  # "immediate", "urgent", "advisory"
    summary: str

class CheckpointRecord(BaseModel):
    id: str
    name: str
    location: GeoCoordinate
    base_capacity: int
    facilities: List[str]
    operational_status: str = "operational"  # "operational", "at_capacity", "flooded_danger"
    warning: Optional[str] = None
    last_verified: str

class IncidentRecord(BaseModel):
    id: str
    title: str
    text: str
    category: str  # "injury", "hazard", "shelter_update"
    severity: str  # "immediate_red", "delayed_yellow", "minimal_green"
    location: GeoCoordinate
    checkpoint_id: Optional[str] = None
    observed_at: str
    lamport_ts: int = 1
    origin_device: str
    synced: bool = False

class EmergencyQueryRequest(BaseModel):
    text: str
    materials: List[str] = []
    breathing: bool = True
    bleeding_type: str = "none"
    location: Optional[GeoCoordinate] = None
