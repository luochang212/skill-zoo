import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(project, "archived/common-commands-demo");
const require = createRequire(path.join(project, "site/package.json"));
const { chromium } = require("@playwright/test");
const { build } = await import(
  pathToFileURL(path.join(project, "node_modules/vite/dist/node/index.js"))
);
const work = await mkdtemp(path.join(tmpdir(), "skill-zoo-demo-"));
const entryName = "__common-command-export-" + process.pid;
const htmlEntry = path.join(project, "src", entryName + ".html");
const scriptEntry = path.join(project, "src", entryName + ".tsx");
const component = path.join(project, "src/components/settings/CommonCommandsEmptyState.tsx");
const stem = path.join(output, "common-commands.zh-light");
const frames = path.join(work, "frames");
const fps = 30;
const duration = 15;
const frameCount = fps * duration;
let browser;

try {
  await mkdir(output, { recursive: true });
  await mkdir(frames);
  await writeFile(
    htmlEntry,
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Skill Zoo · 常用指令演示</title></head><body><div id="root"></div><script type="module" src="./' +
      entryName +
      '.tsx"></script></body></html>',
  );
  await writeFile(
    scriptEntry,
    [
      'import { createRoot } from "react-dom/client";',
      'import { flushSync } from "react-dom";',
      'import { CommonCommandsEmptyState } from "./components/settings/CommonCommandsEmptyState";',
      'import i18n from "./i18n";',
      'import "./index.css";',
      "Object.assign(window, { __demoFlush: flushSync });",
      'document.documentElement.classList.remove("dark");',
      'await i18n.changeLanguage("zh");',
      'createRoot(document.getElementById("root")!).render(<CommonCommandsEmptyState />);',
    ].join("\n"),
  );

  await build({
    configFile: path.join(project, "vite.config.ts"),
    root: path.join(project, "src"),
    logLevel: "warn",
    plugins: [
      {
        name: "export-demo-clock",
        enforce: "pre",
        transform(source, id) {
          if (id.split("?")[0] !== component) return;
          const hook = "const [time, setTime] = useState(0);";
          assert(source.includes(hook), "Animation state hook changed");
          assert(source.includes("if (reducedMotion) return;"), "Animation guard changed");
          assert(source.includes("animate(0, 15,"), "Animation duration changed");
          return source
            .replace(hook, hook + "\n  Object.assign(window, { __demoSetTime: setTime });")
            .replace(
              "if (reducedMotion) return;",
              'if (reducedMotion || Reflect.get(window, "__demoManual")) return;',
            );
        },
      },
    ],
    build: {
      outDir: path.join(work, "build"),
      emptyOutDir: true,
      assetsInlineLimit: 1048576,
      cssCodeSplit: false,
      rolldownOptions: { input: htmlEntry },
    },
  });

  const assets = await readdir(path.join(work, "build/assets"));
  const scripts = assets.filter((name) => name.endsWith(".js"));
  const styles = assets.filter((name) => name.endsWith(".css"));
  assert.equal(scripts.length, 1, "Standalone export needs one bundled script");
  assert.equal(styles.length, 1, "Standalone export needs one stylesheet");
  const js = await readFile(path.join(work, "build/assets", scripts[0]), "utf8");
  const css = await readFile(path.join(work, "build/assets", styles[0]), "utf8");
  let html = await readFile(path.join(work, "build", entryName + ".html"), "utf8");
  const scriptTag = /<script\b[^>]*src="[^"]+"[^>]*>\s*<\/script>/;
  const cssTag = /<link\b[^>]*rel="stylesheet"[^>]*>/;
  assert(scriptTag.test(html) && cssTag.test(html), "Expected Vite output tags");
  html = html
    .replace(
      scriptTag,
      () => '<script type="module">' + js.replace(/<\/script/gi, "<\\/script") + "</script>",
    )
    .replace(
      cssTag,
      () =>
        "<style>" +
        css +
        "\nhtml{color-scheme:light}body{margin:0;background:hsl(var(--background))}#root{width:100%;max-width:1120px;margin:0 auto}#root>div{padding:0}#root svg[role=img]{display:block;width:100%;max-width:none}</style>",
    );
  assert(
    !/<(?:script|link)\b[^>]*(?:src|href)="(?:\.\/)?assets\//.test(html),
    "External asset remains",
  );
  await writeFile(stem + ".html", html);
  console.log("Built self-contained HTML");

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1120, height: 816 },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
    colorScheme: "light",
  });
  await context.addInitScript(() => {
    window.__demoManual = true;
  });
  const page = await context.newPage();
  const pageErrors = [];
  const remoteRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
  });
  await page.goto(pathToFileURL(stem + ".html").href);
  await page.waitForFunction(() => typeof window.__demoSetTime === "function");
  await page.evaluate(() => document.fonts.ready);
  const svg = page.locator('svg[role="img"]');
  const size = await svg.boundingBox();
  assert.equal(size.width, 1120);
  assert.equal(size.height, 816);

  for (let index = 0; index < frameCount; index++) {
    await page.evaluate(
      (time) => window.__demoFlush(() => window.__demoSetTime(time)),
      index / fps,
    );
    await page.screenshot({
      path: path.join(frames, String(index).padStart(4, "0") + ".png"),
      animations: "disabled",
    });
    if ((index + 1) % 90 === 0)
      console.log("Rendered " + (index + 1) + "/" + frameCount + " frames");
  }
  assert.deepEqual(pageErrors, [], "Browser rendering errors");
  assert.deepEqual(remoteRequests, [], "Offline export requested network resources");
  assert.equal((await readdir(frames)).length, frameCount);
  assert.equal(await page.locator('[data-scene="sent-message"]').count(), 1);
  await copyFile(path.join(frames, "0360.png"), stem + ".png");

  const live = await browser.newPage({
    viewport: { width: 1120, height: 816 },
    reducedMotion: "no-preference",
  });
  await live.goto(pathToFileURL(stem + ".html").href);
  await live.waitForFunction(
    () => document.querySelector('[data-scene="skill-zoo"]')?.getAttribute("opacity") === "0",
    null,
    { timeout: 12000 },
  );
  await live.close();
  await browser.close();
  browser = undefined;
  console.log("Verified offline playback and frame sequence");

  const input = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-framerate",
    String(fps),
    "-i",
    path.join(frames, "%04d.png"),
  ];
  const webpArgs = ["-loop", "0", "-min_size", "-lossless", "-q", "100", "-m", "4"];
  for (let index = 0; index < frameCount / 2; index++) {
    const milliseconds = Math.round(((index + 1) * 1000) / 15) - Math.round((index * 1000) / 15);
    webpArgs.push(
      "-d",
      String(milliseconds),
      path.join(frames, String(index * 2).padStart(4, "0") + ".png"),
    );
  }
  webpArgs.push("-o", stem + ".webp");
  const jobs = [
    [
      "MP4",
      "ffmpeg",
      [
        ...input,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "17",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "4",
        "-movflags",
        "+faststart",
        stem + ".mp4",
      ],
    ],
    [
      "WebM",
      "ffmpeg",
      [
        ...input,
        "-c:v",
        "libvpx-vp9",
        "-crf",
        "28",
        "-b:v",
        "0",
        "-deadline",
        "good",
        "-cpu-used",
        "4",
        "-row-mt",
        "1",
        "-threads",
        "4",
        stem + ".webm",
      ],
    ],
    [
      "GIF",
      "ffmpeg",
      [
        ...input,
        "-filter_complex",
        "fps=15,scale=840:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:reserve_transparent=0[p];[b][p]paletteuse=dither=sierra2_4a",
        "-loop",
        "0",
        "-threads",
        "2",
        stem + ".gif",
      ],
    ],
    ["WebP", "img2webp", webpArgs],
  ];
  const results = await Promise.allSettled(
    jobs.map(async ([label, command, args]) => {
      await run(command, args, { maxBuffer: 8 * 1024 * 1024 });
      console.log("Encoded " + label);
    }),
  );
  for (const result of results) if (result.status === "rejected") throw result.reason;

  const metadata = {};
  for (const extension of ["mp4", "webm", "gif"]) {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-count_frames",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,nb_read_frames:format=duration,size",
      "-of",
      "json",
      stem + "." + extension,
    ]);
    const info = JSON.parse(stdout);
    assert(
      Math.abs(Number(info.format.duration) - duration) < 0.15,
      extension + " duration mismatch",
    );
    assert.equal(info.streams[0].width, extension === "gif" ? 840 : 1120);
    assert.equal(info.streams[0].height, extension === "gif" ? 612 : 816);
    assert.equal(Number(info.streams[0].nb_read_frames), extension === "gif" ? 225 : frameCount);
    await run(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", stem + "." + extension, "-f", "null", "-"],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    metadata[extension] = info;
  }
  const { stdout: webpInfo } = await run("webpmux", ["-info", stem + ".webp"]);
  assert(/Canvas size: 1120 x 816/.test(webpInfo), "WebP canvas mismatch");
  const webpFrames = webpInfo
    .split("\n")
    .filter((line) => /^\s*\d+:/.test(line))
    .map((line) => line.trim().split(/\s+/));
  const webpMilliseconds = webpFrames.reduce((sum, row) => sum + Number(row[6]), 0);
  assert.equal(webpMilliseconds, duration * 1000, "WebP duration mismatch");
  assert(/Loop Count : 0/.test(webpInfo), "WebP should loop");
  metadata.webp = {
    width: 1120,
    height: 816,
    frames: webpFrames.length,
    duration: webpMilliseconds / 1000,
    loop: 0,
  };
  await writeFile(
    path.join(output, "verification.json"),
    JSON.stringify(
      { duration, fps, frames: frameCount, pageErrors, remoteRequests, files: metadata },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(output, "README.md"),
    [
      "# 常用指令演示导出",
      "",
      "当前工作区版本，中文浅色，无音频，完整一轮 15 秒。由代码逐帧渲染并编码，没有录屏。",
      "",
      "| 文件 | 用途 | 规格 |",
      "| --- | --- | --- |",
      "| common-commands.zh-light.mp4 | 社交平台、演示文稿、通用播放器 | H.264，1120×816，30 fps |",
      "| common-commands.zh-light.webm | 网页视频 | VP9，1120×816，30 fps |",
      "| common-commands.zh-light.webp | 网页或支持 WebP 的聊天工具，循环播放 | 无损动态 WebP，1120×816，15 fps |",
      "| common-commands.zh-light.gif | 只支持 GIF 的平台，循环播放 | 840×612，15 fps，128 色 |",
      "| common-commands.zh-light.html | 离线浏览器播放，矢量与文字随窗口缩放 | 脚本、样式和图标全部内嵌 |",
      "| common-commands.zh-light.png | 视频封面、静态预览 | 1120×816 |",
      "",
      "HTML 保留 SVG 与嵌入式文字布局，因此使用 HTML 封装，未导出为可能丢失布局或脚本的独立 SVG。GIF 的颜色、文字边缘和体积不如视频或动态 WebP。",
      "",
      "重新生成：在本机执行 node scripts/common-commands-demo/export.mjs。使用仓库现有 Vite、Playwright、Google Chrome 和本机 ffmpeg、img2webp、webpmux、ffprobe；不新增项目依赖。",
      "",
      "verification.json 保存逐帧数量、尺寸、时长、完整视频解码和离线无网络检查结果。",
      "",
    ].join("\n"),
  );
  console.log("Finished: " + output);
} finally {
  if (browser) await browser.close();
  await rm(htmlEntry, { force: true });
  await rm(scriptEntry, { force: true });
  await rm(work, { recursive: true, force: true });
}
