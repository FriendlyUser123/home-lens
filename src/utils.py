"""Utility functions for Home Lens."""
import json
import hashlib
from datetime import datetime
from pathlib import Path


def sha256_file(path):
    """Compute SHA-256 hash of a file."""
    sha256_hash = hashlib.sha256()
    with open(path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


def create_bundle_hash(bundle_dir):
    """Create hash of all files in bundle."""
    bundle_path = Path(bundle_dir)
    hashes = []
    for f in sorted(bundle_path.rglob("*")):
        if f.is_file():
            h = sha256_file(f)
            hashes.append(f"{f.relative_to(bundle_path)}:{h}")
    combined = "\n".join(hashes)
    return hashlib.sha256(combined.encode()).hexdigest()


def timestamp_iso():
    return datetime.now().isoformat() + "Z"


def load_json(path):
    with open(path, 'r') as f:
        return json.load(f)


def save_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    return path
