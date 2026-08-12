---
title: The install line
sidebar_position: 3
---

# The install line

**Why.** An agent needs to know two things about a skill before it runs: that
the bytes are exactly what the publisher meant, and who that publisher is. A
name carries neither. The install line carries both, in about sixty characters.

**How.** The line is the address of a signed manifest. The manifest holds the
publisher key, the signature, and the hash of every file. The line is the hash
of that manifest, so it commits to all of it. Fetch the manifest from anywhere,
check that its hash equals the line, and everything inside is proven at once.

**What.** A line looks like this:

```
sk1qgq6pf8mykkwrqu2ttpynx43f57magyphegd66zrhcpfjz5mlufgaku50584ge6xhzw
```

It uses the same checksummed encoding as a Bitcoin address, so a line damaged by
copy and paste is rejected offline, before any network call.

## Why it is short and still complete

Nothing is left out; it is moved. Spelling the publisher key, the signature, and
the file list into the line would make it long. Putting them inside the manifest
and addressing the manifest by its hash is shorter and gives up nothing: the hash
is the proof.

The address is 256 bits. That is the floor, not a limitation. The threat model
includes a publisher who seals a good version and later serves a bad one, which
is a hash collision. Resisting it needs 256 bits, so the line cannot be shorter
without weakening exactly the guarantee it exists to give.

## Where the bytes come from

The line names no location, on purpose. An address resolves from any store that
has it: a bucket, a mirror, a public gateway. None of them is trusted, because
whatever a store returns is hashed against the address first. A store can fail to
answer; it cannot answer with something else. Point at your own with `--from` or
`SKILLSEAL_STORES`.

## Read one yourself

```bash
skillseal inspect sk1…
```

This decodes the line and shows the manifest address and the publisher, offline.
The [Verify a skill](pathname:///skillseal/hub/seal.html#verify) page does the
same in your browser.
