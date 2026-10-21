# Landing page screenshots

Refreshed on 2026-10-21 from the current desktop frontend on `main`.

| File | View |
| --- | --- |
| `screenshot-1.webp` | Local skill management: agent filters, favorites, archives, and repositories |
| `screenshot-2.webp` | Discover: unified search, bundled banners, and recommended repositories |
| `screenshot-3.webp` | Skill detail: file tree, Markdown editor, and split preview |

The images were captured in a browser using the real React UI with isolated,
mocked Tauri IPC responses. They are interface previews, not native-window or
end-to-end backend captures.

Capture settings: 1100 × 700 CSS pixels, 2× pixel density, light theme, Chinese
locale. Output: 2200 × 1400 WebP at quality 88. No native window frame was added.

Repository recommendations and banners come from `src-tauri/resources/`. Local
skill records, descriptions, installation state, and the `release-checklist`
content are illustrative. No user credentials, private skills, or real home
paths were used. Screenshot tooling and mocks were kept outside the app source.

When refreshing, use the current UI and the same viewport, theme, and scale.
Keep all three output dimensions and the carousel aspect ratio in
`site/src/scripts/carousel.js` and `site/src/styles/global.css` aligned. Check the resulting page in both languages and at
desktop and mobile widths.
