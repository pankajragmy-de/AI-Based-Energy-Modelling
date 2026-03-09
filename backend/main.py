from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Union
import pypsa
import pandas as pd
import numpy as np
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
        
        # Phase 9: 8760-Hour Real-Time Dynamic Simulation
        snapshots = pd.date_range("2026-01-01", periods=8760, freq="h")
        network.set_snapshots(snapshots)
        
        # --- Generate Mock 8760 Time-Series Profiles ---
        # 1. Solar: Bell curve peaking midday, 0 at night.
        hours = np.arange(8760)
        daily_hours = hours % 24
        # Peak at noon (12), drop to 0 before 6am and after 6pm. Add some random noise.
        solar_profile = np.clip(np.sin((daily_hours - 6) * np.pi / 12), 0, 1) 
        solar_profile = solar_profile * np.random.uniform(0.7, 1.0, 8760)
        
        # 2. Wind: Noisy oscillation, higher in winter/spring
        seasonal_wind = 0.6 + 0.4 * np.cos((hours - 8760/4) * 2 * np.pi / 8760)
        wind_profile = np.clip(seasonal_wind * np.random.uniform(0.1, 1.2, 8760), 0, 1)
        
        # 3. Demand: Double hump "duck curve" (Morning and Evening peaks)
        demand_profile = 0.4 + 0.3 * np.exp(-0.5 * ((daily_hours - 8) / 2)**2) + 0.5 * np.exp(-0.5 * ((daily_hours - 19) / 3)**2)
        demand_profile = demand_profile * np.random.uniform(0.9, 1.1, 8760)

        # 2. Add Buses (Nodes)
        # In this simple translation, we treat all UI components as attaching to their own bus,
        # or we treat the connections as Links/Lines.
        # For simplicity, we'll create a single "AC" bus and attach everything to it 
        # for a nodal copper-plate balance, OR we map the UI directly.
        # Let's map the UI exactly: Every node on canvas is a PyPSA Bus.
        
        CAPITAL_COSTS = {
            "solar": 400000, # €/MW
            "wind": 1000000,
            "battery": 300000,
            "mtress_hp": 800000,
            "mtress_chp": 1500000,
            "mtress_st": 200000,
            "mtress_tes": 50000,
            "electrolyzer": 1200000,
        }
        
        total_capex = 0.0
        
        for n in state.nodes:
            # We map every visual node to a PyPSA bus for geometric routing
            network.add("Bus", n.id, carrier="AC")

            # Default capacity handling
            cap = float(n.data.capacity)
            total_capex += cap * CAPITAL_COSTS.get(n.type, 0.0)

            # Assign specific PyPSA components based on type
            if n.type == "solar":
                network.add("Generator", f"Gen_{n.id}", bus=n.id, carrier="solar", p_nom=cap, p_max_pu=solar_profile, marginal_cost=0.01)
            elif n.type == "wind":
                network.add("Generator", f"Gen_{n.id}", bus=n.id, carrier="wind", p_nom=cap, p_max_pu=wind_profile, marginal_cost=0.01)
            elif n.type == "load":
                # Load (dynamic profile)
                network.add(
                    "Load",
                    f"Load_{n.id}",
                    bus=n.id,
                    p_set=cap * demand_profile # Shape the exact MW size with the normalized duck curve
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
        # For the Chart.js visualization, returning 8760 points per generator will freeze the browser.
        # We will extract the first 7 days (168 hours) to show a standard interactive week view.
        PLOT_HOURS = 168 
        
        total_opex = network.objective
        total_cost = (total_capex + total_opex) / 1e6 # Convert to Millions
        
        # Aggregate totals for the doughnut chart (entire year)
        mix = {"Solar": 0.0, "Wind": 0.0, "Storage": 0.0, "Grid/Other": 0.0}
        
        # Extract Time-Series Array data for the line chart (first 168 hours)
        timeseries_data = {
            "hours": [f"H{i}" for i in range(PLOT_HOURS)],
            "demand": np.zeros(PLOT_HOURS).tolist(),
            "solar": np.zeros(PLOT_HOURS).tolist(),
            "wind": np.zeros(PLOT_HOURS).tolist(),
            "storage_dispatch": np.zeros(PLOT_HOURS).tolist(),
            "grid_import": np.zeros(PLOT_HOURS).tolist(),
        }
        
        # Calculate Yearly Mix and 168h Time Series
        for gen in network.generators.index:
            p_series = network.generators_t.p[gen]
            
            carrier = network.generators.loc[gen, "carrier"]
            if carrier == "solar":
                mix["Solar"] += float(p_series.sum())
                timeseries_data["solar"] = (np.array(timeseries_data["solar"]) + p_series.head(PLOT_HOURS).values).tolist()
            elif carrier == "wind":
                mix["Wind"] += float(p_series.sum())
                timeseries_data["wind"] = (np.array(timeseries_data["wind"]) + p_series.head(PLOT_HOURS).values).tolist()
            else:
                mix["Grid/Other"] += float(p_series.sum())
                timeseries_data["grid_import"] = (np.array(timeseries_data["grid_import"]) + p_series.head(PLOT_HOURS).values).tolist()

        for su in network.storage_units.index:
            p_series = network.storage_units_t.p[su]
            # Sum positive discharge values for the yearly mix
            mix["Storage"] += float(p_series[p_series > 0].sum())
            # For time series, show the net flow (positive = discharge, negative = charge)
            timeseries_data["storage_dispatch"] = (np.array(timeseries_data["storage_dispatch"]) + p_series.head(PLOT_HOURS).values).tolist()
            
        for load in network.loads.index:
            p_series = network.loads_t.p_set[load]
            timeseries_data["demand"] = (np.array(timeseries_data["demand"]) + p_series.head(PLOT_HOURS).values).tolist()

        return {
            "status": "success",
            "total_system_cost_millions": round(total_cost, 2),
            "generation_mix": mix,
            "timeseries": timeseries_data,
            "message": "Optimization successful."
        }

    except Exception as e:
        print(f"Error optimizing network: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
