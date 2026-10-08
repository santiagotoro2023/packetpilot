# PacketPilot

Understand networks by watching every packet. A network course with a packet-level lab simulator: build networks, send packets in slow motion and take every frame apart.

<!-- blueprint:rules -->
## The blueprint (binding, read first)

This project follows the **project blueprint 1.1.1** (`.blueprint/`): the gold standard for every
project of this family. Design, logo, installer, deployment, repository layout, tests and docs are the
same in all of them; only the purpose differs. Before any work, read `.blueprint/spec/README.md` and the
spec chapters for what you are about to touch. The spec wins over your own taste and habits.

Absolute rules:

1. **Never edit a file the blueprint writes.** `node .blueprint/tools/blueprint.mjs check` lists them: the
   installer core, build.sh, Dockerfile, deploy/, the workflow, docs/DEPLOYMENT.md, src/css/base.css,
   src/fonts/, src/js/core/, test/run.mjs, test/lib/, the logo SVGs and the marked blocks in README.md
   and here.
   Change them only through `project.conf` and `bash build.sh`, or by updating the blueprint.
   Never touch `.blueprint/`.
2. **The frontend is PacketPilot's design, exactly.** Build every page from the components in
   `.blueprint/spec/01-design.md` with the same markup and class names. Own CSS goes into `src/css/app.css`
   and uses only the tokens of base.css. No other UI framework, no CDN, no web fonts from elsewhere, no emoji.
3. **The menu** (`.rail` in `src/index.html`): 2 to 6 entries, one-word labels of at most 9 characters,
   icons in the style of `src/js/core/icons.js`. The logo comes from `LOGO_PATTERN`/`LOGO_COLORS` only.
4. **No server-side data.** Everything a user does lives in the browser (`src/js/store.js` on top of
   `src/js/core/storage.js`, key `packetpilot.v1`), with backup download and restore on the home page.
   The stored shape only ever grows: never rename or remove a field.
5. **Deviations need the owner's approval first.** If a requirement cannot be met within the blueprint
   (another database, a new dependency, a changed blueprint file, another page layout, …), stop and explain
   to the owner: what, why the blueprint's way does not work here, and the consequences. Only after an
   explicit yes, record it in `DEVIATIONS.md` (format in `.blueprint/spec/11-deviations.md`). An unrecorded
   deviation fails the check and CI.
6. **Words follow `.blueprint/spec/01-design.md`, "Writing"**: plain, calm, sentence case, no exclamation
   marks, buttons say what they do.
7. **Before you say something is done:** `bash build.sh`, `node .blueprint/tools/blueprint.mjs check`,
   `node test/run.mjs`, `node test/run.mjs --browser`, and for installer changes
   `bash test/installer/run.sh debian:12`. All of them green; compare the pages with the reference
   screenshots in `.blueprint/spec/screens/` at 1440 × 900, 1000 × 800 and 390 × 844 in light and dark mode.
8. **Versions:** bump `VERSION` (semantic versioning) with every user-visible change, commit the output of
   `build.sh` (installer, rendered files) together with the change.
<!-- /blueprint:rules -->

## This project

- PacketPilot is the project the blueprint was taken from: its pages are the reference for the design.
- Everything runs in the browser (static profile). The simulation is `src/js/engine.js` with the
  protocols in `services.js`, `ipv6.js`, `dns.js`, `vpn.js`, `bgp.js`, `evpn.js`; the lab UI is
  `lab.js`, `panels.js`, `cli.js`; the course is `src/js/course/m*.js`, the Fix it challenges are
  `challenges.js`, example networks `presets.js`.
- New course content: a lesson is an object in `src/js/course/m*.js`; every lab step needs a reference
  solution in `test/unit/course.test.mjs`, every challenge variant is checked by `challenges.test.mjs`.
- What the browser keeps is `src/js/store.js`; its shape only ever grows (old backups must import).
- The installer must stay updatable from every older PacketPilot: keep the `PP_VERSION` line in
  `installer/app.sh`.
