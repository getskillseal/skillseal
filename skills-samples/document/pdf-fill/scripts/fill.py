#!/usr/bin/env python3
"""Fill a PDF form from a JSON record. Placeholder for the demo sample."""
import json
import sys


def main():
    template, values_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(values_path) as f:
        values = json.load(f)
    # A real skill would call a PDF library here.
    print(f"filled {template} with {len(values)} fields -> {out}")


if __name__ == "__main__":
    main()
