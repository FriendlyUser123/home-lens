"""Report generation."""
import json
from datetime import datetime
from pathlib import Path
from .utils import save_json, timestamp_iso, create_bundle_hash
from .rules import get_rules_for, get_rule
from .measurements import MeasurementExtractor


class ReportGenerator:
    def __init__(self):
        self.extractor = MeasurementExtractor()
    
    def generate_report(self, scan_data, output_dir):
        """
        Generate report JSON and prepare bundle.
        scan_data contains: measurements, keyframes, metadata, etc.
        """
        report = {
            "metadata": {
                "generated_at": timestamp_iso(),
                "version": "1.0",
                "disclaimer": "Information, not legal advice",
                "note": "All measurements include error bars. Where uncertain, status is 'cannot tell'."
            },
            "measurements": [],
            "rule_evaluations": [],
            "gemma_checks": scan_data.get("gemma_checks", []),
            "keyframes": scan_data.get("keyframes", []),
            "bundle_info": {}
        }
        
        # Process measurements
        for meas_dict in scan_data.get("measurements", []):
            from .measurements import Measurement
            meas = Measurement(**meas_dict) if isinstance(meas_dict, dict) else meas_dict
            report["measurements"].append(meas.to_dict())
            
            # Evaluate against relevant rules
            if meas.name == "floor_area":
                rules = get_rules_for("bedroom")
                for rule in rules:
                    if rule["id"] == "bedroom_area_per_occupant":
                        eval_result = self.extractor.evaluate_against_rules(meas, rule)
                        report["rule_evaluations"].append({
                            "measurement": meas.name,
                            "rule_id": rule["id"],
                            "rule_name": rule["name"],
                            "rule_text": rule["rule"],
                            "source": rule["source"],
                            "source_detail": rule["source_detail"],
                            "last_verified": rule["last_verified"],
                            "screening_reference_only": rule["screening_reference_only"],
                            "measured_value": meas.value,
                            "unit": meas.unit,
                            "error_bar": meas.error_bar,
                            "range": [meas.range_min, meas.range_max],
                            **eval_result
                        })
            elif meas.name == "smallest_dimension":
                rules = get_rules_for("bedroom")
                for rule in rules:
                    if rule["id"] == "bedroom_min_dimension":
                        eval_result = self.extractor.evaluate_against_rules(meas, rule)
                        report["rule_evaluations"].append({
                            "measurement": meas.name,
                            "rule_id": rule["id"],
                            "rule_name": rule["name"],
                            "rule_text": rule["rule"],
                            "source": rule["source"],
                            "source_detail": rule["source_detail"],
                            "last_verified": rule["last_verified"],
                            "screening_reference_only": rule["screening_reference_only"],
                            "measured_value": meas.value,
                            "unit": meas.unit,
                            "error_bar": meas.error_bar,
                            "range": [meas.range_min, meas.range_max],
                            **eval_result
                        })
            elif meas.name == "ceiling_height":
                rules = get_rules_for("general")
                for rule in rules:
                    if rule["id"] == "ceiling_height":
                        eval_result = self.extractor.evaluate_against_rules(meas, rule)
                        report["rule_evaluations"].append({
                            "measurement": meas.name,
                            "rule_id": rule["id"],
                            "rule_name": rule["name"],
                            "rule_text": rule["rule"],
                            "source": rule["source"],
                            "source_detail": rule["source_detail"],
                            "last_verified": rule["last_verified"],
                            "screening_reference_only": rule["screening_reference_only"],
                            "measured_value": meas.value,
                            "unit": meas.unit,
                            "error_bar": meas.error_bar,
                            "range": [meas.range_min, meas.range_max],
                            **eval_result
                        })
            elif meas.name == "door_width":
                rules = get_rules_for("door")
                for rule in rules:
                    if rule["id"] == "door_clear_width":
                        eval_result = self.extractor.evaluate_against_rules(meas, rule)
                        report["rule_evaluations"].append({
                            "measurement": meas.name,
                            "rule_id": rule["id"],
                            "rule_name": rule["name"],
                            "rule_text": rule["rule"],
                            "source": rule["source"],
                            "source_detail": rule["source_detail"],
                            "last_verified": rule["last_verified"],
                            "screening_reference_only": rule["screening_reference_only"],
                            "measured_value": meas.value,
                            "unit": meas.unit,
                            "error_bar": meas.error_bar,
                            "range": [meas.range_min, meas.range_max],
                            **eval_result
                        })
        
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        
        report_path = output_dir / "report.json"
        save_json(report_path, report)
        
        return report, report_path

