from abc import ABC, abstractmethod
from typing import Dict, Any

class EnergyModelAdapter(ABC):
    """
    Base class for translating Universal Common Data Model (UCDM) payloads
    into specific energy system modeling frameworks (PyPSA, OEMOF, etc.),
    executing them, and standardizing the outputs.
    """
    
    @abstractmethod
    def execute(self, ucdm_system) -> Dict[str, Any]:
        """
        Executes the model and returns a standardized result dictionary.
        """
        pass

    @abstractmethod
    def translate_to_native(self, ucdm_system):
        """
        Translates UCDM to the specific framework's object model.
        """
        pass
    
    @abstractmethod
    def extract_results(self, native_model) -> Dict[str, Any]:
        """
        Extracts results from the native framework and returns generic dictionary.
        """
        pass
