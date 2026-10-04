# Third-party notices

pi-Forge builds on, includes, or loads the following projects. Their licenses apply to their parts.

## Included in this repository

### AI Icon Pack (MIT)
`packages/harness-web/public/icons-sprite.svg` and `packages/harness-web/public/ai-state.js` come from the AI Icon Pack.

```
MIT License

Copyright (c) 2026 djtoon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Installed from npm (and bundled into packaged harness programs)

- **pi** (`@earendil-works/pi-coding-agent` and its packages), MIT, Copyright (c) 2025 Mario Zechner. https://github.com/earendil-works/pi
- **typebox**, MIT. **yaml**, ISC. **diff** (jsdiff), BSD-3-Clause.
- Packaged harness programs (`npm run package`) embed the **Bun** runtime (MIT, https://bun.sh) and the dependencies pi ships with. Their license files are in `node_modules` and on npm.

## Loaded in the browser from a CDN (not redistributed)

- **3Dmol.js**, BSD-3-Clause (molecule view)
- **marked**, MIT, and **DOMPurify**, Apache-2.0 / MPL-2.0 (markdown rendering)

## Data sources used by the example harnesses

- **PubChem** (chem example): public data from the US National Library of Medicine; see https://pubchem.ncbi.nlm.nih.gov/docs/downloads
