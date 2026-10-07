# Changelog of the blueprint

Every version lists what changed and, under "Projects must", what a project has to do when it
updates to it (`node .blueprint/tools/blueprint.mjs update` prints these sections).

## 1.0.0

The first version, taken from PacketPilot 2.9.1 and proven by converting PacketPilot to it (3.0.0).

- Specification: contract, design, logo, repository, installer, deployment, data, backend,
  testing, documentation, composition, deviations, library, updating; reference screenshots.
- Profiles `static` (browser storage, nginx) and `server` (Node.js, PostgreSQL, backups).
- Core: design system and fonts, web core (ui, icons, storage, site, shell, pack, api), the
  installer (Let's Encrypt, move card, update, backup and restore), Dockerfile, Compose with HTTPS,
  Kubernetes manifest, Helm chart, release workflow, test runner and helpers, conformance tests,
  installer test with the update from the previous release.
- Library: `stats`.
- Tools: `new`, `render`, `check`, `update`, `verify`, `logo`.

Projects must: nothing, new projects start here.
