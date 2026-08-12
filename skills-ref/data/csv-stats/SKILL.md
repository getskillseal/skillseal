---
name: csv-stats
description: Summarize a CSV file (row count, columns, numeric means)
version: 1.0.0
author: example
metadata:
  hermes:
    category: data
    tags: [csv, analysis]
    requires_toolsets: [shell]
---

# Summarize a CSV

## When to Use
The user has a CSV file and wants a quick structural summary: how many rows,
what columns, and the mean of each numeric column.

## Procedure
1. Run `scripts/stats.py <input.csv>`.
2. The script prints a JSON object with `rows`, `columns`, and `numeric_means`.
3. Return that JSON to the user.

## Verification
- `rows` equals the number of data lines (excluding the header).
- Every numeric column appears in `numeric_means`.
