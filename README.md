# suryanshd.github.io

My portfolio. Live at [suryanshd.github.io](https://suryanshd.github.io/).

Hand-written HTML, CSS and JavaScript. No framework, no npm, no build step. Clone it and open
`index.html` in a browser and it works.

## What's in it

The site is organised as the pipeline my work actually sits on: a demand signal becomes generated
content, the content becomes campaigns, the campaigns get ruled on, something serves. Four scroll
stages over a foundation band, with deep dives behind each one.

```
index.html                     the pipeline, the gate demo, projects, experience
resume.html                    résumé; ⌘P prints one clean A4 page
404.html
work/
  compliance-gate.html         ad-compliance proxy, LLM in the approval loop
  generation-surface.html      LLM content and keyword generation
  bulk-uploader.html           spreadsheet to 5,000 paused Meta ads
  answer-surface.html          embeddable RAG answer surface, closed Shadow DOM
  identity.html                IAM v3, three-tier org hierarchy
  mercury-works.html           autonomous AI creative agency
  munshi.html                  bilingual claims processor with abstention
  earlier-research.html        DRDO, IIT Delhi, IBM, student ML
assets/
  css/  base.css index.css case.css print.css
  js/   pipeline.js gate.js site.js  + vendor/ (GSAP, ScrollTrigger, SplitText)
  fonts/ Space Grotesk + JetBrains Mono, self-hosted variable woff2
  img/   favicon.svg, og.png, apple-touch-icon.png
```

## The moving parts

**`assets/js/pipeline.js`**: the particle field. WebGL2 written directly, no three.js. Particle
state lives in a pair of ping-ponged `RGBA32F` textures; a fragment shader advances 65,536 particles
(16,384 on low-power devices) along a path defined by the active stage, and stages morph by mixing
two path samples. About 12KB of GLSL instead of 150KB of framework.

It gives up gracefully. No WebGL2, no float render targets, or `prefers-reduced-motion` and it never
initialises, leaving the inline SVG schematics to carry the diagrams on their own. A frame-time
watchdog drops the pixel ratio once and then bails out entirely if the machine can't keep up, and the
loop pauses when the tab is hidden.

**`assets/js/gate.js`**: the playable compliance gate. A small deterministic rule stack that
returns approved, held or blocked and shows which rule fired. The rules are illustrative and the page
says so; the production policy set is internal.

**`assets/js/site.js`**: theme, the ⌘K palette, scroll orchestration, and the reveal observer.
Everything in it is additive: with JavaScript off the page is still a complete document.

## Conventions

- Static-first. The stacked, motionless layout is what's written; motion is layered on top.
- Light and dark are both designed. `prefers-color-scheme` sets the default, the toggle overrides it
  in both directions, and contrast is AA in each.
- All paths relative, so the site works from `file://` as well as from the deployed root.
- Nothing loads from a CDN. GSAP and both fonts are vendored into the repo.

## Local

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Or just double-click `index.html`.

## Contact

[suryanshdeoliofficial@gmail.com](mailto:suryanshdeoliofficial@gmail.com) ·
[LinkedIn](https://www.linkedin.com/in/suryansh-deoli-22746b212)
