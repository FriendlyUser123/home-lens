"""Rules table with sources and last verified dates."""
# As per CLAUDE.md requirements - every row needs source and last verified date


RULES = [
    {
        "id": "bedroom_area_per_occupant",
        "category": "bedroom",
        "name": "Bedroom floor area per occupant",
        "rule": "70 sq ft minimum plus 50 sq ft per occupant if shared",
        "source": "International Property Maintenance Code 404.4.1",
        "source_detail": "Virginia applies it through its maintenance code; edition not confirmed",
        "last_verified": "2026-10-24",
        "unit": "sq_ft",
        "applies_to": ["bedroom"],
        "screening_reference_only": False
    },
    {
        "id": "bedroom_min_dimension",
        "category": "bedroom", 
        "name": "Bedroom minimum dimension",
        "rule": "7 ft minimum dimension",
        "source": "one county's reading",
        "source_detail": "not confirmed for Blacksburg",
        "last_verified": "2026-10-24",
        "unit": "ft",
        "applies_to": ["bedroom"],
        "screening_reference_only": False
    },
    {
        "id": "ceiling_height",
        "category": "general",
        "name": "Ceiling height",
        "rule": "7 ft minimum ceiling height",
        "source": "one county's reading",
        "source_detail": "not confirmed for Blacksburg",
        "last_verified": "2026-10-24",
        "unit": "ft",
        "applies_to": ["bedroom", "habitable_room"],
        "screening_reference_only": False
    },
    {
        "id": "door_clear_width",
        "category": "accessibility",
        "name": "Door clear width",
        "rule": "32 in minimum clear width",
        "source": "2010 ADA",
        "source_detail": "used as a screening reference only; a rental is not necessarily covered by ADA",
        "last_verified": "2026-10-24",
        "unit": "in",
        "applies_to": ["door"],
        "screening_reference_only": True
    },
    {
        "id": "accessible_route",
        "category": "accessibility",
        "name": "Accessible route",
        "rule": "36 in minimum accessible route",
        "source": "2010 ADA",
        "source_detail": "used as a screening reference only; a rental is not necessarily covered by ADA",
        "last_verified": "2026-10-24",
        "unit": "in",
        "applies_to": ["hallway", "route"],
        "screening_reference_only": True
    }
]


def get_rules_for(item_type=None):
    if item_type:
        return [r for r in RULES if item_type in r["applies_to"]]
    return RULES


def get_rule(rule_id):
    for r in RULES:
        if r["id"] == rule_id:
            return r
    return None
