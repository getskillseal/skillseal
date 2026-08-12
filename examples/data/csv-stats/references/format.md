# CSV expectations

- First row is a header.
- A column is treated as numeric only if every value parses as a float.
- Output is JSON with keys: `rows`, `columns`, `numeric_means`.
