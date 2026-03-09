from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Union
import pypsa
import pandas as pd
import highspy # fast solver

app = FastAPI(title="MetaEnergy Optimization API")

# Allow CORS for the local frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models for incoming JSON
class NodeData(BaseModel):
    label: str
    capacity: Union[str, int, float]

class Node(BaseModel):
    id: str
    type: str
    x: float
    y: float
    data: NodeData

class Connection(BaseModel):
    id: str
    source: str
    target: str

class CanvasState(BaseModel):
    nodes: List[Node]
    connections: List[Connection]

@app.post("/api/solve")
async def solve_network(state: CanvasState):
    try:
        # 1. Initialize empty PyPSA Network
        network = pypsa.Network()
        network.set_snapshots(range(1)) # Single snapshot for simple testing

        # 2. Add Buses (Nodes)
        # In this simple translation, we treat all UI components as attaching to their own bus,
        # or we treat the connections as Links/Lines.
        # For simplicity, we'll create a single "AC" bus and attach everything to it 
        # for a nodal copper-plate balance, OR we map the UI directly.
        # Let's map the UI exactly: Every node on canvas is a PyPSA Bus.
        for n in state.nodes:
            # We map every visual node to a PyPSA bus for geometric routing
            network.add("Bus", n.id, carrier="AC")

            # Default capacity handling
            cap = float(n.data.capacity)

            # Assign specific PyPSA components based on type
            if n.type in ["solar", "wind"]:
                # Generator
                network.add(
                    "Generator",
                    f"Gen_{n.id}",
                    bus=n.id,
                    carrier=n.type,
                    p_nom=cap,
                    p_max_pu=1.0 if n.type == "solar" else 0.8,
                    marginal_cost=0.01 # Near zero marginal cost for renewables
                )
            elif n.type == "load":
                # Load
                network.add(
                    "Load",
                    f"Load_{n.id}",
                    bus=n.id,
                    p_set=cap # fixed demand
                )
            elif n.type in ["battery", "mtress_tes"]:
                # Storage
                network.add(
                    "StorageUnit",
                    f"Storage_{n.id}",
                    bus=n.id,
                    carrier="battery",
                    p_nom=cap,
                    marginal_cost=5.0
                )
            elif n.type == "electrolyzer":
                # Consumes power (Mocking as a simple negative generator or load for now)
                network.add(
                    "Load",
                    f"Load_H2_{n.id}",
                    bus=n.id,
                    p_set=cap * 0.5
                )
            elif "mtress" in n.type or n.type == "amiris" or n.type == "flexigis":
                # Advanced components (Mocked as generators with some marginal cost for OPF testing)
                network.add(
                    "Generator",
                    f"Gen_Adv_{n.id}",
                    bus=n.id,
                    carrier=n.type,
                    p_nom=cap,
                    marginal_cost=50.0 # higher cost than renewables
                )

        # 3. Add Edges (Connections)
        # We model connections as AC lines with large capacity to allow copper-plate flow between connected buses
        for i, conn in enumerate(state.connections):
            # Only connect if both source and target exist
            if conn.source in network.buses.index and conn.target in network.buses.index:
                network.add(
                    "Line",
                    f"Line_{conn.id}_{i}",
                    bus0=conn.source,
                    bus1=conn.target,
                    x=0.0001, # low reactance
                    r=0.0001, # low resistance
                    s_nom=10000.0 # high capacity
                )

        # Ensure we have at least one generator with slack/ext to prevent infeasibility if demand > supply
        if len(state.nodes) > 0:
            first_bus = state.nodes[0].id
            network.add(
                "Generator",
                "Backup_Grid_Import",
                bus=first_bus,
                carrier="AC",
                p_nom=10000.0,
                marginal_cost=150.0 # Expensive grid import
            )

        # 4. Solve the network using Highs (fast linear solver)
        network.optimize(solver_name='highs')

        # 5. Extract Results
        total_cost = network.objective / 1e6 # Convert to Millions
        
        # Generation mix extraction
        mix = {"Solar": 0.0, "Wind": 0.0, "Storage": 0.0, "Grid/Other": 0.0}
        
        for gen in network.generators.index:
            p = network.generators_t.p[gen].iloc[0]
            if p > 0:
                carrier = network.generators.loc[gen, "carrier"]
                if carrier == "solar":
                    mix["Solar"] += p
                elif carrier == "wind":
                    mix["Wind"] += p
                else:
                    mix["Grid/Other"] += p

        for su in network.storage_units.index:
            p = network.storage_units_t.p[su].iloc[0]
            if p > 0: # Discharging
                mix["Storage"] += p

        return {
            "status": "success",
            "total_system_cost_millions": round(total_cost, 2),
            "generation_mix": mix,
            "message": "Optimization successful."
        }

    except Exception as e:
        print(f"Error optimizing network: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
