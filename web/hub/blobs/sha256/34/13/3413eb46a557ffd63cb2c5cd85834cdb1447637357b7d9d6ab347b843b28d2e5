#!/usr/bin/env python3
"""Summarize a CSV: row count, column names, and the mean of numeric columns.
Standard library only, deterministic output."""
import csv
import json
import sys


def main():
    path = sys.argv[1]
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    columns = list(rows[0].keys()) if rows else []
    means = {}
    for col in columns:
        vals = []
        for r in rows:
            try:
                vals.append(float(r[col]))
            except (ValueError, TypeError):
                vals = None
                break
        if vals:
            means[col] = round(sum(vals) / len(vals), 4)
    print(json.dumps({"rows": len(rows), "columns": columns, "numeric_means": means}, sort_keys=True))


if __name__ == "__main__":
    main()
