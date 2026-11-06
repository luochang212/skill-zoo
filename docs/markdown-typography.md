# Markdown typography

The shared `MarkdownContent` reader owns typography for skill details, Discover
previews and repository READMEs. Product UI typography remains unchanged.

## Audit and scope

The app uses Tailwind v4's system font defaults, with no bundled fonts or remote
font loader. The logo has a separate brand font declaration. Most UI sizes use
Tailwind utilities; replacing them globally would change button and card metrics.
The reader previously used `prose-sm` plus heading size utilities, while its code
styles lived in `markdown.css`. It now uses Typography for document structure, explicit compact spacing
and reader-scoped CSS variables for font metrics. Frontmatter remains a compact
metadata table rather than inheriting the document's 15px text size.

## Fixed reader tokens

All reader font families, sizes and line heights live on `.markdown-reader` in
`src/components/skills/markdown.css`. Values use rem/em; the table assumes the
normal 16px root. There is no UI setting, viewport-dependent sizing, app zoom,
platform detection or font-smoothing override. OS/WebView accessibility settings
and display scaling are not disabled.

| Content | Default size | Line height | Weight |
| --- | --- | --- | --- |
| Body | 15px | 1.7 | 400 |
| H1 | 23px | 1.35 | 600 |
| H2 | 19px | 1.4 | 600 |
| H3 | 17px | 1.4 | 600 |
| H4–H6 | 15px | 1.4 | 600 |
| Inline code | 0.875em (~13px in body) | inherited | 400 |
| Code block | 13px | 1.65 | 400 |
| Frontmatter | 13px | 1.6 | existing field emphasis |

Inline code follows heading/table context rather than shrinking heading code to
13px. Block code keeps whitespace and scrolls horizontally. Tables retain normal
word widths and scroll within the reader; prose and long inline paths can wrap.
Highlight token styles only color/emphasize tokens; `pre` owns code layout.

Paragraphs, lists, quotes, tables and code blocks use a 14px block gap; section
headings use 24px above and 12px below. List item/paragraph spacing is tighter.
This keeps the reader closer to the surrounding 13–14px tool UI without changing
source emphasis or scaling the entire application.

## Offline font fallback

No Inter or JetBrains Mono files are added, and their incidental installation
does not change the preferred stack. No remote font requests are required.

- macOS: Apple system UI font, then explicit PingFang SC for missing Chinese
  glyphs; `ui-monospace`/SFMono-Regular/Menlo for code.
- Windows: Segoe UI, then Microsoft YaHei for Chinese; the platform monospace
  choice, Cascadia Mono or Consolas for code.
- Linux: Noto Sans/Arial where available, then Noto Sans CJK SC/Noto Sans SC and
  generic sans-serif; Liberation Mono/Noto Sans Mono CJK SC and generic monospace
  for code. Generic fallback follows fontconfig and distribution configuration.

The browser chooses fonts per glyph; system fonts may themselves provide CJK
fallback. Chinese in code may use a proportional fallback when a CJK monospace
font is unavailable. CSS cannot supply missing glyphs on an installation with no
CJK fonts. Exact glyph shapes, hinting and rasterization are not identical across
OSes; guaranteeing that would require licensed bundled font coverage.

## Verification

The shared fixture `src/components/skills/__fixtures__/reader.txt` covers Chinese,
English, mixed prose, headings, inline paths, long URLs, code variants, tasks,
nested lists, tables and quotes. Component tests preserve its semantic structure.

Browser checks load the real component and application CSS at 360px and 1100px
viewports, in light/dark themes, using Chromium and WebKit. Assertions cover the
computed metrics above, unchanged external UI size, retained inline paragraph
height, code padding/whitespace/scrolling, task markers and document overflow.
DPR values 1, 1.25, 1.5 and 2 cover rasterization/layout smoke checks, **not** native
Windows display scaling. Screenshots are inspected at narrow/wide widths.

Windows WebView2, Linux WebKitGTK, older Safari 16.4, physical non-Retina hardware,
and native OS scaling/accessibility configurations require testing on those
systems. A macOS-hosted browser/DPR check must not be reported as that coverage.

Validation: the initial font-stack adjustment passed 413 frontend tests and 32
DPR/theme/width checks. The subsequent compact adjustment was checked against the
actual arkcli-api-explorer document and shared fixture: 8 Chromium/WebKit checks
at 360/1100px, light/dark, with 15px/25.5px body, 23/19/17px headings, explicit
block/heading spacing and unchanged 13px code layout. Native OS coverage remains
limited as described above. No backend code changed for typography.

## CJK emphasis

The shared reader enables `remark-cjk-friendly/parseOnly` and
`remark-cjk-friendly-gfm-strikethrough/parseOnly` after `remark-gfm`. This lets
`**技术栈：**React` render emphasis around CJK punctuation without changing source
files. The extensions apply to emphasis and GFM strikethrough; they do not repair
all malformed Markdown. Escaped markers, inline/fenced code, and invalid whitespace
boundaries retain their literal meaning. Existing HTML sanitization and link
handling remain in place. Only parsing entry points are imported because the
reader does not serialize Markdown.
