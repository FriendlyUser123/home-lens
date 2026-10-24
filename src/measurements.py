"""Measurement extraction with error bars."""
import math
from dataclasses import dataclass, asdict
from typing import List, Optional


@dataclass
class Measurement:
    """A measured value with error bar."""
    name: str
    value: float
    unit: str
    error_bar: float
    error_type: str = "absolute"  # absolute or relative
    method: str = ""
    confidence: float = 1.0
    notes: str = ""
    
    def to_dict(self):
        return asdict(self)
    
    @property
    def error_percent(self):
        if self.value == 0:
            return 0
        if self.error_type == "relative":
            return self.error_bar * 100
        return (self.error_bar / abs(self.value)) * 100
    
    @property
    def range_min(self):
        if self.error_type == "relative":
            return self.value * (1 - self.error_bar)
        return self.value - self.error_bar
    
    @property
    def range_max(self):
        if self.error_type == "relative":
            return self.value * (1 + self.error_bar)
        return self.value + self.error_bar


class MeasurementExtractor:
    """Extract room measurements from scan data."""
    
    def __init__(self, calibration_error=0.02):
        """
        calibration_error: relative error from tape-measure calibration
        Target is under ~5% as per go/no-go gate
        """
        self.calibration_error = calibration_error
    
    def compute_floor_area(self, floor_polygon_points):
        """Compute floor area from polygon using shoelace formula."""
        if len(floor_polygon_points) < 3:
            return Measurement(
                name="floor_area",
                value=0.0,
                unit="sq_ft",
                error_bar=0.0,
                method="shoelace",
                confidence=0.0,
                notes="Insufficient points"
            )
        
        # Shoelace formula
        n = len(floor_polygon_points)
        area = 0.0
        for i in range(n):
            j = (i + 1) % n
            area += floor_polygon_points[i][0] * floor_polygon_points[j][1]
            area -= floor_polygon_points[j][0] * floor_polygon_points[i][1]
        area = abs(area) / 2.0
        
        # Convert to sq ft if in meters (assuming input in meters)
        area_sq_ft = area * 10.7639
        
        # Error bar from calibration and fitting
        error = area_sq_ft * (self.calibration_error + 0.01)  # extra for polygon fitting
        return Measurement(
            name="floor_area",
            value=round(area_sq_ft, 2),
            unit="sq_ft",
            error_bar=round(error, 2),
            method="shoelace_from_plane_fitting",
            confidence=0.9,
            notes=f"From {len(floor_polygon_points)} polygon points"
        )
    
    def compute_smallest_dimension(self, floor_polygon_points):
        """Find smallest dimension of the room."""
        if len(floor_polygon_points) < 2:
            return Measurement(
                name="smallest_dimension",
                value=0.0,
                unit="ft",
                error_bar=0.0,
                method="min_distance",
                confidence=0.0
            )
        
        # Find minimum distance between parallel edges or just min extent
        # Simplified: compute axis-aligned bounding box min dimension
        xs = [p[0] for p in floor_polygon_points]
        ys = [p[1] for p in floor_polygon_points]
        width_m = max(xs) - min(xs)
        depth_m = max(ys) - min(ys)
        min_dim_m = min(width_m, depth_m)
        min_dim_ft = min_dim_m * 3.28084
        
        error = min_dim_ft * (self.calibration_error + 0.015)
        return Measurement(
            name="smallest_dimension",
            value=round(min_dim_ft, 2),
            unit="ft",
            error_bar=round(error, 2),
            method="polygon_extent",
            confidence=0.85,
            notes="Axis-aligned extent; may not reflect actual smallest clear dimension"
        )
    
    def compute_ceiling_height(self, floor_points, ceiling_points):
        """Compute ceiling height from floor and ceiling plane points."""
        if not floor_points or not ceiling_points:
            return Measurement(
                name="ceiling_height",
                value=0.0,
                unit="ft",
                error_bar=0.0,
                method="plane_distance",
                confidence=0.0,
                notes="Insufficient points"
            )
        
        # Estimate average heights (assuming z is up)
        floor_z = sum(p[2] for p in floor_points) / len(floor_points)
        ceiling_z = sum(p[2] for p in ceiling_points) / len(ceiling_points)
        height_m = abs(ceiling_z - floor_z)
        height_ft = height_m * 3.28084
        
        error = height_ft * (self.calibration_error + 0.01)
        return Measurement(
            name="ceiling_height",
            value=round(height_ft, 2),
            unit="ft",
            error_bar=round(error, 2),
            method="plane_distance_ransac",
            confidence=0.9
        )
    
    def compute_door_width(self, point1, point2):
        """Compute door width from two human-picked points."""
        if not point1 or not point2:
            return Measurement(
                name="door_width",
                value=0.0,
                unit="in",
                error_bar=0.0,
                method="human_picked_points",
                confidence=0.0,
                notes="No points provided"
            )
        
        dx = point2[0] - point1[0]
        dy = point2[1] - point1[1]
        dz = point2[2] - point1[2]
        dist_m = math.sqrt(dx*dx + dy*dy + dz*dz)
        dist_in = dist_m * 39.3701
        
        # Human picking introduces small error
        error = dist_in * (self.calibration_error + 0.02)
        return Measurement(
            name="door_width",
            value=round(dist_in, 1),
            unit="in",
            error_bar=round(error, 1),
            method="human_picked_two_points",
            confidence=0.95,
            notes="Door width by two human-picked points as per plan"
        )
    
    def compute_hallway_width(self, point1, point2):
        """Compute hallway width."""
        dist_m = math.sqrt((point2[0]-point1[0])**2 + 
                          (point2[1]-point1[1])**2 + 
                          (point2[2]-point1[2])**2)
        dist_in = dist_m * 39.3701
        error = dist_in * (self.calibration_error + 0.02)
        return Measurement(
            name="hallway_width",
            value=round(dist_in, 1),
            unit="in",
            error_bar=round(error, 1),
            method="human_picked_two_points",
            confidence=0.9
        )
    
    def evaluate_against_rules(self, measurement, rule):
        """Evaluate measurement against a rule."""
        if measurement.confidence < 0.3 or measurement.value == 0:
            return {
                "status": "cannot tell",
                "reason": "Low confidence or zero measurement"
            }
        
        rule_val = self._parse_rule_value(rule["rule"], rule["unit"])
        if rule_val is None:
            return {
                "status": "cannot tell",
                "reason": "Could not parse rule"
            }
        
        # For minimum requirements
        if "minimum" in rule["rule"].lower():
            if measurement.value >= rule_val - measurement.error_bar:
                return {"status": "pass", "reason": "Meets minimum (within error)"}
            elif measurement.value + measurement.error_bar < rule_val:
                return {"status": "fail", "reason": "Below minimum (outside error)"}
            else:
                return {"status": "cannot tell", "reason": "Unclear within error bounds"}
        else:
            return {"status": "cannot tell", "reason": "Rule type not evaluated"}
    
    def _parse_rule_value(self, rule_text, unit):
        """Parse numeric value from rule text."""
        import re
        # Look for numbers
        numbers = re.findall(r'[\d.]+', rule_text)
        if not numbers:
            return None
        # Handle conversions if needed
        val = float(numbers[0])
        if unit == "sq_ft" and "50 sq ft" in rule_text and len(numbers) > 1:
            # This is more complex, return base value
            pass
        return val
