# design-sync notes

- The SwaggerBot design system was authored in claude.ai/design (project "SwaggerBot",
  0054d8fd-c31b-4daa-b090-ff2c8e0867e6). `docs/design/swaggerbot-design-system-v2/` is that
  project's own export, in its native layout (`components/<group>/<Name>.jsx|.d.ts|.prompt.md`,
  one `*.card.html` per group, `guidelines/*.html`). It is not a component package, so the
  converter (`package-build.mjs`) doesn't apply: sync by uploading the changed source files
  at the same paths.
- Never upload `_ds_bundle.js`, `_ds_manifest.json`, `_adherence.oxlintrc.json` or `_builtin.json`
  from the local copy: the app generates them. Write the `_ds_needs_recompile` sentinel before
  and after the files so the app rebuilds them.
- 2026-09-27: first push back to the project: the build's adaptations (DESIGN.md "Adaptations
  from the kit"), the new tagline NAME IT. GET THE SPEC., ProvenanceBadge and MethodBadge.
  No `_ds_sync.json` anchor was written (no converter receipt), so a later sync re-verifies all.
