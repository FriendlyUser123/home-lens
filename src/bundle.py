"""Record bundle creation with hashing."""
import json
import os
from pathlib import Path
from datetime import datetime
from .utils import sha256_file, create_bundle_hash, timestamp_iso, save_json


class BundleCreator:
    """Create hashed, timestamped bundle of scan results."""
    
    def __init__(self, output_base="data/bundles"):
        self.output_base = Path(output_base)
        self.output_base.mkdir(parents=True, exist_ok=True)
    
    def create_bundle(self, scan_id, report_path, keyframes_dir=None, 
                     mesh_path=None, poses_path=None, additional_files=None):
        """Create a bundle with all scan data."""
        bundle_dir = self.output_base / scan_id
        bundle_dir.mkdir(parents=True, exist_ok=True)
        
        bundle_manifest = {
            "scan_id": scan_id,
            "created_at": timestamp_iso(),
            "server_timestamp": datetime.now().isoformat(),
            "files": [],
            "disclaimer": "Information, not legal advice"
        }
        
        copied_files = []
        
        # Copy report
        if report_path and Path(report_path).exists():
            import shutil
            dest = bundle_dir / "report.json"
            shutil.copy2(report_path, dest)
            copied_files.append(dest)
            bundle_manifest["files"].append({
                "name": "report.json",
                "sha256": sha256_file(dest),
                "size": dest.stat().st_size
            })
        
        # Copy keyframes
        if keyframes_dir and Path(keyframes_dir).exists():
            keyframes_bundle_dir = bundle_dir / "keyframes"
            keyframes_bundle_dir.mkdir(exist_ok=True)
            kf_dir = Path(keyframes_dir)
            for kf in kf_dir.glob("*.jpg"):
                import shutil
                dest = keyframes_bundle_dir / kf.name
                shutil.copy2(kf, dest)
                copied_files.append(dest)
                bundle_manifest["files"].append({
                    "name": f"keyframes/{kf.name}",
                    "sha256": sha256_file(dest),
                    "size": dest.stat().st_size
                })
            for kf in kf_dir.glob("*.png"):
                import shutil
                dest = keyframes_bundle_dir / kf.name
                shutil.copy2(kf, dest)
                copied_files.append(dest)
                bundle_manifest["files"].append({
                    "name": f"keyframes/{kf.name}",
                    "sha256": sha256_file(dest),
                    "size": dest.stat().st_size
                })
        
        # Copy mesh if exists
        if mesh_path and Path(mesh_path).exists():
            import shutil
            mesh_p = Path(mesh_path)
            dest = bundle_dir / mesh_p.name
            shutil.copy2(mesh_p, dest)
            copied_files.append(dest)
            bundle_manifest["files"].append({
                "name": mesh_p.name,
                "sha256": sha256_file(dest),
                "size": dest.stat().st_size
            })
        
        # Copy poses if exists
        if poses_path and Path(poses_path).exists():
            import shutil
            poses_p = Path(poses_path)
            dest = bundle_dir / poses_p.name
            shutil.copy2(poses_path, dest)
            copied_files.append(dest)
            bundle_manifest["files"].append({
                "name": poses_p.name,
                "sha256": sha256_file(dest),
                "size": dest.stat().st_size
            })
        
        # Additional files
        if additional_files:
            for f in additional_files:
                if Path(f).exists():
                    import shutil
                    fp = Path(f)
                    dest = bundle_dir / fp.name
                    shutil.copy2(f, dest)
                    copied_files.append(dest)
                    bundle_manifest["files"].append({
                        "name": fp.name,
                        "sha256": sha256_file(dest),
                        "size": dest.stat().st_size
                    })
        
        # Create bundle hash
        bundle_hash = create_bundle_hash(bundle_dir)
        bundle_manifest["bundle_hash"] = bundle_hash
        bundle_manifest["bundle_hash_algorithm"] = "sha256"
        
        # Save manifest
        manifest_path = bundle_dir / "manifest.json"
        save_json(manifest_path, bundle_manifest)
        
        # Create a downloadable bundle info
        bundle_info = {
            "scan_id": scan_id,
            "bundle_path": str(bundle_dir),
            "manifest_path": str(manifest_path),
            "bundle_hash": bundle_hash,
            "created_at": bundle_manifest["created_at"],
            "file_count": len(bundle_manifest["files"]) + 1  # +manifest
        }
        
        return bundle_info, bundle_dir
```
