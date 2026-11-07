# Third-Party Notices & Open-Source Attribution

**MoChess — Wizard Chess: Arcane Kingdom** is original software created by **Dimas Mong** ([https://github.com/dimasmong](https://github.com/dimasmong)) and distributed under the [MIT License](./LICENSE).

All custom TypeScript source code, procedurally sculpted 3D chess piece & arena geometries (`public/models/*.glb`, `src/assets/PieceGeometryBuilder.ts`), 2K procedural PBR textures (`src/assets/ProceduralTextures.ts`), WebGL selection previews (`public/previews/**/*.png`), and synthesized musical compositions (`public/audio/music/*.wav`, `scripts/generate_magical_music_assets.mjs`, `src/audio/SoundManager.ts`) are original works of this project released under the MIT License.

MoChess builds upon and gratefully acknowledges the following third-party open-source software and fonts, each governed by its respective license:

---

## 1. Runtime Dependencies

### Three.js (`three`)
- **Website / Repository**: https://threejs.org/ — https://github.com/mrdoob/three.js
- **Copyright**: Copyright © 2010–2026 Three.js authors
- **License**: **MIT License**

### chess.js (`chess.js`)
- **Repository**: https://github.com/jhlywa/chess.js
- **Copyright**: Copyright © 2023 Jeff Hlywa (`jhlywa@gmail.com`)
- **License**: **BSD-2-Clause License**

---

## 2. Typography (Loaded via Google Fonts)

### Cinzel
- **Designer**: Natanael Gama
- **Source**: https://fonts.google.com/specimen/Cinzel
- **License**: **SIL Open Font License 1.1 (OFL-1.1)**

### Inter
- **Designer**: Rasmus Andersson
- **Source**: https://fonts.google.com/specimen/Inter
- **License**: **SIL Open Font License 1.1 (OFL-1.1)**

---

## 3. Build, Testing & Asset Pipeline Tooling (Development Only)

| Package / Tool | Repository / Website | License |
| :--- | :--- | :--- |
| **TypeScript** | https://github.com/microsoft/TypeScript | Apache-2.0 |
| **Vite** | https://github.com/vitejs/vite | MIT |
| **Vitest** | https://github.com/vitest-dev/vitest | MIT |
| **Playwright (`playwright-core`)** | https://github.com/microsoft/playwright | Apache-2.0 |
| **jsdom** | https://github.com/jsdom/jsdom | MIT |
| **Blender** *(optional CLI workflow for `scripts/blender/generate_pieces.py`)* | https://www.blender.org/ | GPL-3.0-or-later *(tool license; no Blender binary or GPL runtime code is bundled)* |
