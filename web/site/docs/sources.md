---
title: Sources and decentralization
sidebar_position: 6
---

# Sources and decentralization

**Why.** A skill you can only get from one place is a skill someone else can take
away. If it lives at one server, one bucket, or one registry, then a takedown, an
outage, an expired account, or a change of mind removes it for everyone. The
sealed line is meant to outlive any of that, so it must not depend on any single
place to hand back the bytes.

**How.** The line names the skill by its content hash, not by a location. A hash
is a universal name: any host that holds the bytes can answer to it, and the
holder does not have to be trusted, because whatever it returns is hashed again
and compared to the name before a single byte is used. A wrong or hostile source
can only fail to answer. It can never answer with something else.

That one property is what makes many sources safe. Because every source is
checked the same way, they are interchangeable, and adding more of them costs
nothing in trust. This is the same shape as a torrent: a piece is named by its
hash, many peers hold it, and the client verifies each piece against the name no
matter which peer sent it. BitTorrent version two even names pieces with the same
SHA-256 a sealed skill uses, so the alignment is exact.

**What.** Every sealed skill resolves from a set of independent sources, tried
together, first correct answer wins:

* a public content mirror, so a pasted line resolves with no setup
* a broad set of independent IPFS gateways, any of which can serve the bytes by
  their address
* the IPFS network itself, reachable by the same address from any peer, no
  gateway required
* any mirror you add, from a colleague, a bucket, an internal host, or your own
  machine

None of them is trusted. Remove any subset and the rest still resolve.

## See the swarm

Open any skill in the hub and the **Sources** panel probes every independent
source live, in your own browser, and rehashes what each returns against the
address. A green tick is proof, not a claim, and the count reads plainly: served
by so many of so many sources right now. Some may not answer on a given day. The
skill still resolves, and you can watch that it does.

From the command line the same view is one command:

```bash
skillseal sources sk1…
```

It lists every place the manifest and each file can be fetched from, pings them
in parallel, verifies the bytes, and prints which answered and how fast. A peer
list, where every peer is checked against the hash.

## Add your own source

Any host laid out by hash is a source. Point at one for a single install:

```bash
skillseal add sk1… --from https://mirror.example.com
```

Or set it for every install, several at once, most preferred first:

```bash
export SKILLSEAL_STORES="https://mirror.example.com,https://getskillseal.github.io/skillseal/hub"
```

The gateway set is open the same way, through `SKILLSEAL_GATEWAYS`. Because
everything is verified against the address, a new source can never weaken an
install. It can only make the skill harder to lose.

## Publish to more places

The more unrelated places hold a skill, the harder it is to take offline. When
you seal a skill, record where its bytes live, and pin them widely:

```bash
skillseal publish ./my-skill --upload
```

`--upload` puts every file in the configured store and records the address it
comes back with, so anyone can later fetch the same bytes through any gateway.
Pinning the same content with more than one provider, and mirroring it on hosts
you control, turns a single copy into a swarm. The address never changes, so
every added copy is just one more place the same line resolves from.

## The guarantee

Because the name is the hash:

* no source is trusted, so more sources only add resilience
* any source can vanish without breaking the skill
* what you install is provably the bytes the line names, whichever source served
  them

Decentralization here is not a separate feature bolted on. It is what content
addressing already gives you, made visible and made easy to widen.
