# 岸瞳 SurfCam · 摄像头浪况自动播报

冲浪俱乐部的海滩摄像头测浪系统。它从视频里跟踪每一道浪破碎时翻起的白沫峰线，用两道白沫经过同一块礁石的时间差求周期，用白沫向岸传播速度按浅水波速反推水深，并从破碎前竖起的浪壁换算波高；同时判断卷浪方向、可冲指数和天气导致的可信度，最后生成当天浪况曲线与可直接发群的播报。

技术栈：**TypeScript + Vite + 原生 DOM/Canvas + Web Worker**。无需后端和数据库；机位、标定与最近分析结果保存在浏览器 `localStorage`。

## 快速开始

```bash
npm install
npm run generate:samples   # 已生成在 public/samples；删除后可用此命令重建
npm run dev
```

打开终端给出的地址（默认 <http://127.0.0.1:5173/>）。

生产构建：

```bash
npm run build
npm run preview
```

核心算法离线校验（直接在合成帧上跑检测/跟踪并对照真值）：

```bash
npm run validate
```

## 页面

| 路由 | 页面 | 内容 |
| --- | --- | --- |
| `#/cameras` | 摄像头管理 | 机位卡片、样例/视频地址、天气模式、启用状态、增删改、进入分析/标定 |
| `#/calibration` | 相机标定 | 相机离海面高度、俯角、水平视场角、海图水深；点击画面设置基准礁石；地平线与 8–60 m 投影网格 |
| `#/analysis` | 浪况分析 | 16× 快放解码、Worker 浪峰检测跟踪、Canvas 峰线叠加、周期/波高/水深/方向/可信度、逐道浪表、浮标海图对标 |
| `#/report` | 每日播报 | 全天波高/周期 Canvas 曲线、最佳窗口、可信度区间、中文群播报、复制/TXT/语音预览 |

## 测量原理

所有像素坐标均按归一化坐标保存，因此检测分辨率变化不会破坏标定。

### 1. 像素行 → 海面距离

针孔相机焦距：

\[
f=\frac{W}{2\tan(\mathrm{HFOV}/2)}
\]

像素行 `y` 对应的垂直俯角：

\[
\theta(y)=\theta_{\mathrm{tilt}}+\arctan\frac{y-H/2}{f}
\]

相机离海面高度为 \(H_c\)，则该像素行与海面交点的水平距离：

\[
Z(y)=\frac{H_c}{\tan\theta(y)}
\]

标定页会实时画出该投影关系下的等距线。

### 2. 周期

白沫峰线用低饱和、高亮度像素提取，经连通域和矩拟合得到峰线。跟踪器把同一道浪的峰线关联起来，并在峰线与基准礁石的交点越过标定 `reef.y` 时做线性插值，记录精确过礁时间。

\[
T=\operatorname{median}(t_{n+1}^{\mathrm{reef}}-t_n^{\mathrm{reef}})
\]

重复碎片产生的 3.8 秒内近似事件会合并，避免一道浪报两次。

### 3. 传播速度与水深

跟踪浪壁底边（暗色浪壁到前景海面的边缘）或礁石行的海面距离序列 \(Z(t)\)，稳健线性拟合：

\[
c=-\frac{dZ}{dt}
\]

浅水波速只与水深有关：

\[
c=\sqrt{gD}\quad\Longrightarrow\quad D=\frac{c^2}{g},\qquad g=9.81\ \mathrm{m/s^2}
\]

### 4. 波高

破碎前浪壁顶边和底边对应两条视线。底边射线先得到水平距离 \(Z_b\)，顶边射线俯角为 \(\alpha_t\)，则浪壁顶部距海面：

\[
H_{\mathrm{wave}}=H_c-Z_b\tan\alpha_t
\]

系统在峰线附近多列搜索“暗浪壁 → 亮海面”的最强垂直边缘，取中位数，避免单像素噪声。

### 5. 卷浪方向与可冲性

跟踪白沫剥离/破碎中心的横坐标：

- `dx/dt > 阈值`：画面左侧 → 右侧卷（`ltr`）；
- `dx/dt < -阈值`：画面右侧 → 左侧卷（`rtl`）；
- 否则为方向不明/可能闭合浪。

可冲评分综合波高、周期、方向、天气和可信度，并给出适合、一般、不建议、风险四档及原因。

### 6. 可信度

自动统计平均亮度、对比度、白沫比例、雨线/垂直高频和眩光；机位也可预置下雨或逆光。下雨系数约 `0.68`，逆光约 `0.62`，再叠加低对比/眩光修正。低可信度会同时出现在分析结果、曲线点和播报文案中。

## Web Worker 与 Canvas

- `src/workers/analysis.worker.ts`：持有 `SurfPipeline`，执行连通域检测、峰线拟合、跟踪、过礁事件和汇总。
- `src/lib/detector.ts`：纯像素检测与浪壁几何。
- `src/lib/tracker.ts`：多目标关联、周期/速度/方向聚合、可冲评分。
- 主线程仅负责 `<video>` 解码、按媒体时间 3 Hz 抽帧和消息调度；`ImageData.data.buffer` 通过 Transferable 移入 Worker。
- `src/components/overlay.ts`：在视频上用 Canvas 画浪峰线、置信度、礁石和过礁差线。
- `src/components/charts.ts`：全天波高/周期双曲线、置信渐变、悬浮提示。

## 样例视频与真值

`scripts/sample-model.ts` 用确定性涌浪模型逐帧生成 RGB 画面：天空、海面透视纹理、竖起浪壁、剥离移动的白沫线、礁石、雨线/逆光效果。`scripts/generate-samples.ts` 将原始帧通过本机 FFmpeg 编码为 H.264 MP4，并写出：

- `public/samples/*.mp4`：4 种涌浪/天气条件；
- `public/samples/benchmark-10m.mp4`：600 秒性能基准；
- `public/samples/truth.json`：每道浪的过礁时间、周期、波高、波速、水深、方向，以及同步浮标和海图水深；
- `public/samples/cameras.seed.json`：机位种子。

| 样例 | 周期真值 | 波高真值 | 水深真值 | 方向 | 天气 |
| --- | ---: | ---: | ---: | --- | --- |
| `clean-ltr` | 8.5 s | ~1.16 m | 2.9 m | 左→右 | 晴 |
| `long-rtl` | 12.0 s | ~1.79 m | 4.0 m | 右→左 | 晴 |
| `heavy-rain-ltr` | 14.0 s | ~2.32 m | 4.8 m | 左→右 | 雨 |
| `backlight-rtl` | 7.5 s | ~0.90 m | 2.3 m | 右→左 | 逆光 |

## 对标结果

### 核心算法离线校验

`npm run validate` 在 3 Hz 采样下直接运行 TypeScript 检测/跟踪管线。当前结果（Node 24）：

- 周期误差：`0.01–0.03 s`，要求 `<0.5 s`；
- 波高相对偏差：`0.4%–7.8%`，要求 `<20%`；
- 水深相对偏差：`0.4%–11.7%`，要求 `<25%`；
- 四种条件的卷浪方向全部正确。

### 真实 H.264 解码后的浏览器校验

用 Chrome Headless 打开生产构建并实际播放/分析 `clean-ltr.mp4`：

- 视觉周期 `8.47 s` vs 浮标 `8.5 s`，误差 `0.03 s`；
- 波高 `1.23 m` vs 浮标有效波高 `1.11 m`，偏差约 `10.8%`；
- 水深 `3.08 m` vs 海图 `2.9 m`，偏差约 `6.2%`；
- 方向正确，6/6 验收项通过；
- 72 秒样例墙钟约 `4.8 s`。

### 十分钟性能

`benchmark-10m.mp4` 为完整 600 秒 H.264 视频。Chrome Headless 中以 `16×` 快放、3 Hz 抽帧、Worker 检测，端到端等待约 **38 秒**（包含视频播放、抽帧、检测和汇总），满足“十分钟录像一分钟内给出浪况”。不同机器会有差异；页面会显示本次实际墙钟、处理帧数和实时倍率。

## 目录结构

```text
scripts/
  generate-samples.ts     # FFmpeg 样例视频/真值生成入口
  sample-model.ts         # 确定性涌浪与相机透视渲染模型
  validate-core.ts        # 容差自动校验
public/samples/           # 已生成 MP4、truth.json、相机种子
src/
  components/charts.ts    # 全天 Canvas 曲线
  components/overlay.ts   # 浪峰线 Canvas 叠加
  data/defaults.ts
  data/dailySeed.ts
  lib/detector.ts         # 白沫/连通域/浪壁检测
  lib/tracker.ts          # 峰线跟踪、周期、速度、水深、评分
  lib/geometry.ts         # 相机几何与浅水公式
  lib/analysisRunner.ts   # video + Worker 快算调度
  lib/storage.ts
  pages/                  # 四个页面
  workers/analysis.worker.ts
```

## 对真实海滩视频的说明

合成样例的相机几何与渲染模型严格一致，因此适合验证算法链路和验收指标。接入真实摄像头时，仍需在标定页完成一次高度、俯角、FOV 和礁石位置校准，并尽量让画面包含：

1. 清晰可见、长期不被淹没的固定礁石；
2. 破碎前完整浪壁，而不是只有破碎后的白雾；
3. 16:9 且与标定一致的视角；若摄像头存在明显桶形畸变，应先做镜头去畸变；
4. 雨天定期清洁镜头，逆光机位可在管理页固定天气模式。

浏览器不能直接读取 RTSP。生产部署时可让摄像头/NVR 输出 HLS、MP4 录像片段或 WebRTC，并把 URL 填入摄像头管理；当前版本可直接分析浏览器支持的 MP4/WebM 和本地视频文件。
