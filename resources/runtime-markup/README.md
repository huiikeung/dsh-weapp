# Runtime markup sources

Edit these readable files, then run `node scripts/compact-runtime-markup.cjs`.
The generated copies in `miniprogram/` omit comments and redundant indentation
to stay within the existing package budget. Selectors, declarations, bindings,
and text content are preserved. `scripts/stamp-build.cjs` runs this step before
checking package sizes. Regression tests detect stale generated output.
