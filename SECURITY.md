# Security and privacy

## What this project promises

Keret publishes copies of your photographs. Two guarantees matter:

1. **Metadata is stripped.** Published copies are re-encoded, so EXIF (including
   GPS coordinates), XMP and embedded thumbnails are dropped. `sharp` is a hard
   requirement precisely because the fallback - copying the original bytes -
   would publish that metadata. A build that cannot re-encode fails instead of
   shipping originals.
2. **The original files stay out of the repository.** `photos/` is gitignored
   and the build never writes into it; the output-directory guards refuse to run
   when the output path would contain the photos.

## Reporting a problem

If you find a way to make the build publish metadata, escape the page's
script context, or delete files outside its output directory, please report it
privately rather than in a public issue: open a GitHub security advisory
(Security tab, "Report a vulnerability") or email the maintainer listed in
`package.json`.

Please include the version/commit, the config (minus secrets), and a minimal
reproduction. You can expect an acknowledgement within a few days.

## Supported versions

The `main` branch is the supported version. This is a small personal project;
fixes land on `main` and are released by tagging.
