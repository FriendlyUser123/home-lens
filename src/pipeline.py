"""Main pipeline for scan to report."""
import json
from pathlib import Path
from .measurements import MeasurementExtractor, Measurement
from .report import ReportGenerator
from .gemma import GemmaChecker
from .bundle import BundleCreator
from .utils import timestamp_iso


class ScanPipeline:
    def __init__(self):
        self.extractor = MeasurementExtractor()
        self.report_gen = ReportGenerator()
        self.gemma = GemmaChecker()
        self.bundle_creator = BundleCreator()
    
    def process_scan(self, scan_id, scan_data, output_dir="data/output"):
        """
        Process a scan end-to-end.
        scan_data should contain: floor_polygon, ceiling_points, floor_points, 
        door_points (list of (p1,p2)), hallway_points, keyframes, etc.
        """
        output_path = Path(output_dir) / scan_id
        output_path.mkdir(parents=True, exist_ok=True)
        
        measurements = []
        
        # Extract measurements
        if scan_data.get("floor_polygon"):
            floor_area = self.extractor.compute_floor_area(scan_data["floor_polygon"])
            measurements.append(floor_area.to_dict())
            
            smallest_dim = self.extractor.compute_smallest_dimension(scan_data["floor_polygon"])
            measurements.append(smallest_dim.to_dict())
        
        if scan_data.get("floor_points") and scan_data.get("ceiling_points"):
            ceiling_height = self.extractor.compute_ceiling_height(
                scan_data["floor_points"], 
                scan_data["ceiling_points"]
            )
            measurements.append(ceiling_height.to_dict())
        
        if scan_data.get("door_points"):
            for i, (p1, p2) in enumerate(scan_data["door_points"]):
                door_width = self.extractor.compute_door_width(p1, p2)
                meas_dict = door_width.to_dict()
                meas_dict["name"] = f"door_{i+1}_width"
                measurements.append(meas_dict)
        
        if scan_data.get("hallway_points"):
            for i, (p1, p2) in enumerate(scan_data["hallway_points"]):
                hallway_width = self.extractor.compute_hallway_width(p1, p2)
                meas_dict = hallway_width.to_dict()
                meas_dict["name"] = f"hallway_{i+1}_width"
                measurements.append(meas_dict)
        
        # Prepare scan data for report
        report_input = {
            "measurements": measurements,
            "keyframes": scan_data.get("keyframes", []),
            "gemma_checks": []
        }
        
        # Generate report
        report, report_path = self.report_gen.generate_report(report_input, output_path)
        
        # Gemma analysis (if keyframes provided)
        if scan_data.get("keyframes"):
            gemma_result = self.gemma.analyze_keyframes(scan_data["keyframes"], measurements)
            # Update report with gemma results
            report["gemma_analysis"] = gemma_result
            from .utils import save_json
            save_json(report_path, report)
        
        # Create bundle
        bundle_info, bundle_dir = self.bundle_creator.create_bundle(
            scan_id=scan_id,
            report_path=report_path,
            keyframes_dir=scan_data.get("keyframes_dir"),
            mesh_path=scan_data.get("mesh_path"),
            poses_path=scan_data.get("poses_path")
        )
        
        report["bundle_info"] = bundle_info
        save_json(report_path, report)
        
        return {
            "scan_id": scan_id,
            "measurements": measurements,
            "report_path": str(report_path),
            "bundle_info": bundle_info,
            "output_dir": str(output_path)
        }

