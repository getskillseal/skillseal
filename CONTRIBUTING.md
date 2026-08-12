# Contributing

Thanks for helping make agent skills something you can trust.

## Layout

```
skillseal/   the CLI and library (npm: skillseal)
skills-ref/    sample skills, each a folder with a SKILL.md
web/hub/     the Sealed Skills browser (static)
web/site/    the docs site (static)
docs/        design notes and assets
demo/        a runnable security demo
```

## Develop

```bash
git clone https://github.com/getskillseal/skillseal
cd skillseal
npm install
node skillseal/test/v2.test.mjs   # the CLI test suite
./demo/demo.sh                    # the security demo, proof in demo/evidence/
```

## Pull requests

* Keep the surface small. A change that adds a folder or a flag should earn it.
* Anything that touches the install line, the manifest, or verification needs a
  test in [`skillseal/test/`](skillseal/test/).
* Match the surrounding style. Prose stays plain and concise.
* A sealed skill must remain a plain Agent Skills folder. Backward compatibility
  is not negotiable.

## Reporting a security issue

Open a private advisory on GitHub rather than a public issue.
