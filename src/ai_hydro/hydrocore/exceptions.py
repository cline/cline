
class HydroError(Exception):
    """Base class for hydrology exceptions."""
    pass

class DelineationError(HydroError):
    """Raised when watershed delineation fails."""
    pass

class DataUnavailableError(HydroError):
    """Raised when required DEM or vector data is not found."""
    pass
