# 定制家具板材开料优化（Furniture Cutting Optimizer）

把一批定制柜体零件清单丢进去，自动算出要买几张板、每张板怎么摆、按什么顺序下锯、连封边米数和五金胶量一起给出来。
纯前端 Vue 3 + Typecript + Vite 单页应用，**无后端、无外部 CDN、断网可用**，数据仅保存在浏览器 localStorage。

## 技术栈与约束

- Vue 3 `<script setup>` 单文件组件 + TypeScript（状态仅用 ref/reactive/computed/watch，无 Pinia/Vuex）
- Vite 5 构建；vue-router 4；手写 CSS（无 UI 组件库、无图表/游戏/物理库）
- 排样与刀路全部本地实时计算（≤1000 零件），不使用 worker/Service Worker

## 核心能力（对应规格书 §4/§5）

1. **板材库**：2440×1220 / 2745×1220 / 1830×915 等常用规格、厚度、材质、单价、库存张数；锯路 kerf（默认 3.2mm）、四周修边（5~10mm）可配。
2. **guillotine 贯通排样**：递归二分布局，只产生推台锯/电子锯可直接加工的矩形分割，禁止把小块塞进缝里；多板种混排（柜体板 + 背板）、按柜体批次分组开料。
3. **纹理硬约束**：竖纹/横纹件一律不旋转（`rotated=false`），无纹理件自动选朝向；放不下时明确提示「因纹理要求（不可旋转），现有板材排不下」，绝不偷转。
4. **锯路/修边精确扣除**：零件间净距与四周边距均 ≥ kerf/trim；利用率分母=板面积，分子=零件净面积（不含锯路、不含锯缝两侧余量）。
5. **裁切步骤动画与打印**：输出每一刀的轴向、坐标、贯通区间；同向刀连续排程（减少推台翻转），同规格板修边刀按叠切合并计数；页面可逐步播放（灰线→红线→已切），并支持 A4 打印贴在机器旁。
6. **材料统计**：张数、利用率、封边见光/非见光分列（按零件实际边长逐边累加）、三合一/木榫/螺丝/封边胶估算、板材成本，以及「比随手排省 N 张、约 X 元」。
7. **余料登记与闭环**：每张板剩余矩形按面积降序记录，两边 ≥300mm 标为可用；一键登记后，在新项目零件清单页勾选即以「小板材」身份**优先参与下一轮排样**，用掉自动标记已用。
8. **手工微调**：排样图上可拖动零件到余料矩形或与同尺寸零件交换；每次松手立即做 guillotine 合法性校验并重新生成刀路，非贯通排法拒绝并撤销。
9. **导出**：排样图、裁切步骤表、下料单/领料单、A4 不干胶标签（每块零件一张），浏览器打印/另存 PDF；项目可导出/导入 JSON。

## 目录结构

```
app-031/
├── index.html
├── package.json / vite.config.ts / tsconfig*.json
├── src/
│   ├── main.ts / router.ts / App.vue / global.css
│   ├── data/boards.json         # 常用板材与五金参数（本地打包）
│   ├── lib/
│   │   ├── types.ts             # 规格书 §7 数据模型
│   │   ├── packing.ts           # guillotine 排样 + 随手排基线
│   │   ├── cuts.ts              # 刀路合并排序 + 逐刀模拟器 + 微调重算
│   │   ├── geometry.ts          # guillotine 合法性校验
│   │   ├── selftest.ts          # 100 组随机自动化断言
│   │   ├── store.ts             # reactive 单例 + localStorage
│   │   └── print.ts / format.ts / colors.ts / ui.ts
│   ├── components/SheetDiagram.vue / PrintDocument.vue
│   └── views/ Home / Parts / Nest / Cut / Stats / Offcuts / Export
├── Dockerfile / docker-compose.yml / nginx.conf
└── .dockerignore / .gitignore
```

## 启动命令

```bash
npm install
npm run dev          # 本地开发 http://localhost:5173
npm run build        # 类型检查 + 产物到 dist/
npm run preview      # 预览生产构建
```

## Docker（多阶段：node:20-alpine 构建 → nginx:1.27-alpine 运行）

```bash
docker compose up -d --build
# 服务：http://localhost:8111
curl http://localhost:8111/healthz      # -> ok
docker compose down
```

nginx 已配置 SPA 回退、`/assets/` 哈希资源 immutable 强缓存、index.html no-cache、gzip 与 `/healthz` 健康检查；compose 含 `restart: unless-stopped` 与 HEALTHCHECK。

## 自检与验收结果

首页「运行算法自检」会在浏览器里真实执行 `src/lib/selftest.ts`（开发期另用 Node/esbuild 做过 30 个随机种子 × 100 组共 3000 组压测，零反例）：

- 100 组随机任务：guillotine 合法性、逐步切割模拟零件尺寸全部正确、纹理零旋转、锯路/修边净距、守恒（Σ排样数=总数、Σ板面积≥Σ零件面积、利用率复算）
- 30 个零件 ≤ 20 个锯切工步，且逐刀模拟后零件尺寸全部正确
- 纹理件超板幅时明确提示且不强制旋转
- 余料登记后作为小板材优先参与下一轮排样
- 300 个零件排样耗时 < 1.5s（实测约 10ms 量级）
- 手工微调的合法/塞缝布局判定准确，增量校验 < 80ms
