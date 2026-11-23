# Self-hosted fonts

| File | Source | Licence | SHA-384 |
|---|---|---|---|
| Inter-Regular.woff | Inter 4.x (rsms.me/inter), subset to Latin + Latin-1/Extended-A + currency and arrow symbols | SIL Open Font License 1.1 | `6c1bc8a9e2517943ab2240db499f6708b947231009af3546570f593c65d35aa526f5c091148211ea557ab4683d000258` |
| Inter-SemiBold.woff | same | same | `3884784aa453aad6030f85a43bd825be284e17027bb36f10335c3e2fd618a4d29e31304d30478294a48a7fa69bfe64b1` |

Served from this site only (CSP `font-src 'self'`), no CDN. The other Appearance fonts (IBM Plex Sans, Atkinson Hyperlegible, Source Serif 4, JetBrains Mono) are **not bundled yet**: the build environment could not download them, so they are used only when already installed on the user's device and otherwise fall back to the named system font. To bundle one, add its OFL-licensed subset here, add an `@font-face` in `docs/js/appearance.js` and set `bundled: true`.
