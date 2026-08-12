# skillseal 🦭

Install an agent skill from one line that proves what it is.

```bash
npx skillseal add sk1qgq6pf8mykkwrqu2ttpynx43f57magyphegd66zrhcpfjz5mlufgaku50584ge6xhzw
```

The line is the address of a signed manifest. `add` checks its bech32m checksum
offline, resolves the manifest from any content store (a default public mirror,
or your own via `--from` / `SKILLSEAL_STORES`), verifies the publisher signature
and every file hash, and only then writes a plain [Agent Skills](https://agentskills.io/home)
folder into whichever agents it finds. One altered byte and it refuses, leaving
nothing on disk.

```bash
skillseal where                        # the agents found on this machine
skillseal add sk1…                     # verify a line, then install it
skillseal inspect sk1…                 # read a line, fully offline
skillseal publish ./my-skill --upload  # print the line other people paste
```

A publisher key is a self certifying **anchor** — `sha256(algorithm, key)`. Bind
it to a domain with `publish --bind example.com` and `add` reports the trust
level (cryptographic / config / unsigned). Unsigned lines are refused unless you
pass `--allow-unsigned`.

Full docs, the Sealed Skills browser, and a runnable security demo:
<https://getskillseal.github.io/skillseal/> ·
<https://github.com/getskillseal/skillseal>

MIT
