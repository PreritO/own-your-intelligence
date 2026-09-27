"""Step one: which base models can this River key use? Picks the smallest capable one.

    python -m server.train.models
"""
from __future__ import annotations

from .common import MODEL_PREFERENCE, pick_base_model, river_client, river_key


def main() -> None:
    if not river_key():
        print("RIVER_API_KEY not set (env or .env). Everything runs in --dry-run mode.")
        print(f"Preference order once a key exists: {', '.join(MODEL_PREFERENCE)}")
        return
    client = river_client()
    print("healthy:", client.health_check())
    print("available models:")
    for name in client.get_capabilities():
        print(" ", name)
    print("picked:", pick_base_model(client))


if __name__ == "__main__":
    main()
