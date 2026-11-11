# Contribute a skill

Fork this repository, add one new folder at `skills/<skill-slug>/`, and open a pull request against `main`. Keep changes inside that folder. The folder name is a unique, lowercase slug with hyphens between words. Use a new slug. Ask the maintainer about changes to an existing skill.

- `SKILL.md` is the instruction file. Use plain Markdown and explain the inputs, outputs, and approval points.
- `skill.json` describes the skill. Follow [the schema](skill.schema.json).
- `LICENSE` must include the full MIT license and your own copyright notice. Use the root [LICENSE](LICENSE) as a template and replace its copyright line.
- `examples/` may contain flat, small UTF-8 Markdown, text, or JSON examples. Include fictional data only.

In `skill.json`, give a name, slug, one-line description, GitHub author handle (without @), a public GitHub source URL, MIT license, semantic version, tags, and created and updated dates in YYYY-MM-DD. Pick one pipeline stage: research, design, prep, approval, listing, publishing, marketing, analytics, ops, or other. Leave `source_type` out or set it to `Community`. You may set `episode` to a related episode slug.

Keep API keys, tokens, passwords and private URLs out of every file. Skills that scrape sites, marketplaces or feeds, automate prohibited third-party design services, bypass access controls, copy other sellers' designs, or hide network calls are rejected. Explain shell commands and ask for human approval before publishing. Read the [review rules](REVIEW_RULES.md) before opening your PR.

The Action validates the submission and posts one verdict. The maintainer reads the submission and makes the merge decision. Contributions and the review comment are public. After a submission passes local validation in the Action, its instruction files and examples are sent to the AI review provider.
