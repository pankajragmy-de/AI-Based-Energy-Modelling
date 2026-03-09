import oemof.solph as solph
import pandas as pd
from typing import Dict, Any
from .base import EnergyModelAdapter

class OEMOFAdapter(EnergyModelAdapter):
    """
    Adapter for OEMOF (Open Energy Modelling Framework).
    """

    def __init__(self):
        self.energy_system = None
        self.buses = {}

    def execute(self, ucdm_system) -> Dict[str, Any]:
        self.translate_to_native(ucdm_system)
        
        # Create EnergySystem Model
        model = solph.Model(self.energy_system)
        
        # Execute solver
        try:
            model.solve(solver='cbc', solve_kwargs={'tee': False})
            self.energy_system.results['main'] = solph.processing.results(model)
        except Exception as e:
            print(f"OEMOF Solve warning (returning mock data): {e}")
            
        return self.extract_results(self.energy_system)

    def translate_to_native(self, ucdm_system):
        # Initialize an empty OEMOF energy system
        time_index = pd.date_range('2026-01-01', periods=ucdm_system.time_steps, freq='H')
        self.energy_system = solph.EnergySystem(timeindex=time_index, infer_last_interval=False)
        self.buses = {}
        
        # Add Nodes -> OEMOF Buses
        for node in ucdm_system.nodes:
            bus = solph.Bus(label=node.id)
            self.buses[node.id] = bus
            self.energy_system.add(bus)
            
        # Add Components -> OEMOF Sources/Sinks/Transformers/Storages
        for comp in ucdm_system.components:
            bus = self.buses.get(comp.node_id)
            if not bus:
                continue
                
            if comp.comp_type == "generator":
                source = solph.components.Source(
                    label=comp.id,
                    outputs={
                        bus: solph.Flow(
                            nominal_value=comp.attributes.get("nominal_value", 100),
                            variable_costs=comp.attributes.get("variable_costs", 10)
                        )
                    }
                )
                self.energy_system.add(source)
                
            elif comp.comp_type == "load":
                sink = solph.components.Sink(
                    label=comp.id,
                    inputs={
                        bus: solph.Flow(
                            fix=comp.attributes.get("fix", [0.5]*ucdm_system.time_steps),
                            nominal_value=comp.attributes.get("nominal_value", 100)
                        )
                    }
                )
                self.energy_system.add(sink)
                
            elif comp.comp_type == "transformer":
                pass # Translation for transformers
                
        # OEMOF deals with directed graph flows differently than AC line representations.
        # "Edges" in UCDM would translate to either solph.Flow properties or a Transformer.

    def extract_results(self, native_model) -> Dict[str, Any]:
        # Process solph dict
        try:
            if 'main' not in native_model.results:
                return {"status": "mocked", "info": "Solver dependencies missing in env."}
            
            # Simple metadata extraction for now
            return {"status": "success", "info": "OEMOF Solph optimization finished successfully."}
        except Exception:
            return {"status": "mocked", "info": "Unable to extract OEMOF results."}
