# 常用指令演示导出

当前工作区版本，中文浅色，无音频，完整一轮 15 秒。由代码逐帧渲染并编码，没有录屏。

| 文件 | 用途 | 规格 |
| --- | --- | --- |
| common-commands.zh-light.mp4 | 社交平台、演示文稿、通用播放器 | H.264，1120×816，30 fps |
| common-commands.zh-light.webm | 网页视频 | VP9，1120×816，30 fps |
| common-commands.zh-light.webp | 网页或支持 WebP 的聊天工具，循环播放 | 无损动态 WebP，1120×816，15 fps |
| common-commands.zh-light.gif | 只支持 GIF 的平台，循环播放 | 840×612，15 fps，128 色 |
| common-commands.zh-light.html | 离线浏览器播放，矢量与文字随窗口缩放 | 脚本、样式和图标全部内嵌 |
| common-commands.zh-light.png | 视频封面、静态预览 | 1120×816 |

HTML 保留 SVG 与嵌入式文字布局，因此使用 HTML 封装，未导出为可能丢失布局或脚本的独立 SVG。GIF 的颜色、文字边缘和体积不如视频或动态 WebP。

重新生成：在本机执行 node scripts/common-commands-demo/export.mjs。使用仓库现有 Vite、Playwright、Google Chrome 和本机 ffmpeg、img2webp、webpmux、ffprobe；不新增项目依赖。

verification.json 保存逐帧数量、尺寸、时长、完整视频解码和离线无网络检查结果。

输出固定写入仓库的 `archived/common-commands-demo/`，会覆盖同名导出文件；脚本与说明保存在 `scripts/common-commands-demo/`。脚本根据自身位置定位仓库，不依赖当前工作目录。

本次复核：保留时间轴变化时的断言、临时文件清理、离线资源检查、视频完整解码与 WebP 时长检查。WebP 保持无损编码，避免浅色背景残影。失败时可能保留部分导出文件，修复原因后重新运行即可。
