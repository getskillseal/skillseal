---
name: pdf-fill
description: Fill a PDF form from a JSON record
version: 1.0.0
author: example
metadata:
  hermes:
    category: document
    tags: [pdf, forms, automation]
    requires_toolsets: [shell]
---

# Fill a PDF Form

## When to Use
The user has a fillable PDF and a set of field values, and wants a completed copy.

## Procedure
1. Read the field map in `references/fields.md`.
2. Run `scripts/fill.py <template.pdf> <values.json> <out.pdf>`.
3. Return the absolute path to the output PDF.

## Pitfalls
- Flatten the form only if the user asks; flattened PDFs are not re-editable.

## Verification
- Confirm every required field in the field map is present in the output.
