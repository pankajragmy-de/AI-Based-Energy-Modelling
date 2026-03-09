import datetime
from typing import Dict, Any

# Knowledge Base Mappings extracted during Phase 1
ATTRIBUTION_DB = {
    "pypsa": {
        "framework": "PyPSA (Python for Power System Analysis)",
        "institutions": ["TU Berlin", "KIT", "Open-Source Community"],
        "license": "MIT License",
        "reference_url": "https://pypsa.org/"
    },
    "oemof": {
        "framework": "OEMOF (Open Energy Modelling Framework)",
        "institutions": ["Reiner Lemoine Institut (RLI)", "Open-Source Community"],
        "license": "MIT License",
        "reference_url": "https://oemof.org/"
    },
    "remix": {
        "framework": "REMix (Renewable Energy Mix)",
        "institutions": ["German Aerospace Center (DLR)"],
        "license": "Open-Source",
        "reference_url": "https://gitlab.com/dlr-ve/esm/remix"
    },
    "fine": {
        "framework": "FINE (Framework for Integrated Energy System Assessment)",
        "institutions": ["Forschungszentrum Jülich (FZJ) - IEK-3"],
        "license": "MIT License",
        "reference_url": "https://github.com/FZJ-IEK3-VSA/FINE"
    }
}

def get_attribution_record(framework_id: str) -> Dict[str, Any]:
    """
    Returns an automated attribution record to attach to all simulation
    outputs, ensuring open-source legal compliance and academic tracking.
    """
    record = ATTRIBUTION_DB.get(framework_id.lower())
    if not record:
        return {
            "error": f"Unknown framework ID '{framework_id}'. No attribution available."
        }
        
    # Append dynamic run details
    record["run_timestamp"] = str(datetime.datetime.now())
    record["generated_by"] = "Meta Energy Framework Engine"
    record["legal_notice"] = f"This run utilized logic from {record['framework']} under the {record['license']}. Please cite appropriately."
    
    return record
