"""Gemma 4 integration for qualitative checks."""
import json
from pathlib import Path
from .utils import timestamp_iso


class GemmaChecker:
    """Gemma 4 reads original keyframes for qualitative checks.
    Gemma never produces the numbers and never reads distances off a render.
    Gemma cannot read a mesh file; it can only see images.
    Each claim must be tied to a frame; user confirms or rejects."""
    
    def __init__(self, model="gemma-4-26b-a4b-it", use_local=False):
        self.model = model
        self.use_local = use_local
        self.api_available = False  # Will be set based on env
    
    def prepare_prompt(self, measurements_summary, keyframe_paths):
        """Prepare prompt with measurements summary and keyframes."""
        prompt = f"""You are assisting with a room scan report. 
You must ONLY do qualitative checks based on what you see in the images.
You MUST NOT estimate or guess distances, areas, heights, or widths.
You MUST NOT read measurements from renders or meshes.

Here are the MEASURED FACTS (from the scan pipeline):
{json.dumps(measurements_summary, indent=2)}

Your task:
1. Look at each keyframe and note qualitative observations
2. For each observation, cite the specific frame filename
3. Check for: window visible, smoke detector visible, step at doorway, etc.
4. Write a plain-language summary
5. Each claim MUST be tied to a frame
6. If you cannot tell from the image, say "cannot tell"

You are providing INFORMATION only, not legal advice.

Respond in JSON format with checks array and summary.
"""
        return prompt
    
    def analyze_keyframes(self, keyframes, measurements):
        """Analyze keyframes with Gemma. Returns checks that need user confirmation."""
        # This is a stub - in practice would call API or local Ollama
        measurements_summary = []
        for m in measurements:
            measurements_summary.append({
                "name": m.get("name"),
                "value": m.get("value"),
                "unit": m.get("unit"),
                "error_bar": m.get("error_bar")
            })
        
        prompt = self.prepare_prompt(measurements_summary, [k.get("path") for k in keyframes])
        
        # For now, return placeholder structure
        return {
            "status": "pending",
            "model": self.model,
            "prompt": prompt,
            "checks": [],
            "summary": "",
            "note": "Gemma analysis requires API key or local Ollama. User must confirm each check."
        }

    
    def process_checks(self, checks, confirmations):
        """Process user confirmations of Gemma checks."""
        processed = []
        for check in checks:
            conf = confirmations.get(check.get("frame") + "_" + check.get("observation", "")[:20], None)
            check["user_confirmed"] = conf
            check["confirmed_at"] = timestamp_iso() if conf is not None else None
            processed.append(check)
        return processed

