from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from .adapters.pypsa_adapter import PyPSAAdapter
from .adapters.oemof_adapter import OEMOFAdapter
from .attribution import get_attribution_record

app = FastAPI(title="Meta Energy Framework API", version="0.1.0")

# Universal Common Data Model (UCDM)
class Node(BaseModel):
    id: str
    label: str
    node_type: str = "bus" # e.g. AC, DC, Heat
    attributes: Dict[str, Any] = {}

class Edge(BaseModel):
    id: str
    source: str
    target: str
    capacity: Optional[float] = None
    efficiency: Optional[float] = 1.0
    attributes: Dict[str, Any] = {}

class Component(BaseModel):
    id: str
    node_id: str
    comp_type: str # generator, load, storage
    attributes: Dict[str, Any] = {}

class UCDMSystem(BaseModel):
    nodes: List[Node]
    edges: List[Edge]
    components: List[Component]
    time_series: Dict[str, List[float]] = {}
    time_steps: int = 1

class RunRequest(BaseModel):
    system: UCDMSystem
    target_framework: str # "pypsa", "oemof", "fine", "remix"
    chained_run_id: Optional[str] = None # Support chaining models

class RunResponse(BaseModel):
    status: str
    results: Dict[str, Any]
    attribution: Dict[str, Any]

@app.post("/api/run_model", response_model=RunResponse)
async def run_model(request: RunRequest):
    framework = request.target_framework.lower()
    
    if framework == "pypsa":
        adapter = PyPSAAdapter()
    elif framework == "oemof":
        adapter = OEMOFAdapter()
    else:
        raise HTTPException(status_code=400, detail=f"Framework {framework} adapter not yet fully implemented or registered.")
    
    try:
        # Translate UCDM and run optimization
        results = adapter.execute(request.system)
        
        # Track open-source attribution
        attribution_data = get_attribution_record(framework)
        
        return RunResponse(
            status="success",
            results=results,
            attribution=attribution_data
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
