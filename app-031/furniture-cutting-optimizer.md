# 定制家具板材开料优化 · Furniture Cutting Optimizer

> 类型：前端 Web 应用（纯前端）｜难度：★★★★｜技术栈：**Vue 3 + TypeScript + Vite**（`<script setup>` 单文件组件；自写 2D 排样与裁切步骤生成；禁用 UI 组件库与图表库，见 README §5.1）

## 1. 一句话简介
把一批定制柜体零件的清单丢进去，算出要买几张板、每张板怎么摆、按什么顺序下锯，连封边米数和余料尺寸一起给出来。

## 2. 真实场景与痛点
- 定制家具厂的成本大头是板材：利用率从 75% 提到 88%，一批柜子就能省一张板以上。
- **纹理方向有要求**：柜门、见光侧板必须竖纹，随手旋转一块就整张门废掉，这是开料最常见的报废原因。
- **锯路要扣**：板材锯缝一般 3.2mm，排样时忘记扣锯路，锯出来零件全部小 3mm。
- **必须能按直线锯切到底**（推台锯/电子锯），自由排样（把小块塞进缝里）在车间做不出来。
- 封边是按米算钱的（甚至分见光边/非见光边），手工统计封边量经常漏。
- 一张板切完剩的余料如果能记录尺寸，下次还能用；现在基本当废料丢。

## 3. 目标用户
- 定制家具门店/工厂的开料师傅与排产员。
- 木工工作室与装修队（现场开料）。
- 板式家具 DIY 爱好者。

## 4. 核心功能（MVP）
1. **板材库**：常见规格（2440×1220、2745×1220、1830×915…）、厚度（18/25mm）、材质与单价；锯路（kerf，默认 3.2mm）、修边（四周修掉 5~10mm）。
2. **零件清单**：名称、长 × 宽、数量、**纹理要求**（竖纹/横纹/无要求）、**封边边数**（哪些边要封）、所在柜体/房间（便于分拣）、是否见光。
3. **排样（核心）**：guillotine（直线贯通可锯）约束下的 2D 装箱；纹理要求为竖纹/横纹的零件**不允许旋转**；输出每张板的零件位置与编号。
4. **裁切步骤**：生成「第 1 刀切在哪、第 2 刀切在哪」的步骤序列，逐步高亮；支持打印贴在机器旁。
5. **材料统计**：板材张数、利用率、封边总米数（按见光/非见光分列）、五金与胶量（按零件数估算）。
6. **余料清单**：每张板剩余的最大可用余料尺寸（≥ 300×300mm 才记）与面积，标注下次可优先使用。
7. **导出**：排样图（带零件编号与尺寸）、裁切步骤表、领料单/下料单、标签（每块零件贴标签便于分拣）。

## 5. 进阶功能
- 多种板材混排（柜体板 + 背板）与按柜体批次分组开料。
- 与手工排样对比（显示「按本方案比随手排省了 N 张板」）。
- 余料优先：把已登记的余料作为可用的「小板材」参与排样。
- 排版微调（手工拖动/交换后重新校验 guillotine 合法性）。

## 6. 页面结构
```
/                 项目列表与新建
/parts/:id        零件清单（录入/导入/纹理与封边设置）
/nest/:id         排样结果（每张板视图、编号、利用率）
/cut/:id          裁切步骤（逐步高亮 + 步骤清单打印）
/stats/:id        材料统计（板材/封边/五金）
/offcuts          余料登记与再利用
/export/:id       导出（排样图、下料单、标签）
```

## 7. 数据模型
```ts
type Board = { id: string; name: string; wMm: number; hMm: number; thicknessMm: number;
               priceCents: number; quantity: number; /* 库存张数，0=不限 */ };
type GrainDemand = 'length'|'width'|'none';              // 竖纹/横纹/无
type Part = { id: string; code: string; name: string; lenMm: number; widMm: number;
              qty: number; grain: GrainDemand; edgeBands: ('top'|'bottom'|'left'|'right')[];
              cabinet: string; exposed: boolean };
type Placement = { partId: string; boardIndex: number; x: number; y: number;
                   lenMm: number; widMm: number; rotated: boolean; seq: number };
type CutStep = { boardIndex: number; axis: 'v'|'h'; at: number; span: [number, number]; order: number };
type SheetResult = { index: number; boardId: string; placements: Placement[]; steps: CutStep[];
                     usedAreaMm2: number; boardAreaMm2: number; utilization: number;
                     offcuts: { wMm: number; hMm: number; areaMm2: number }[] };
type Job = { id: string; boards: Board[]; parts: Part[]; kerfMm: number; trimMm: number;
             result?: { sheets: SheetResult[]; boardsUsed: number; boardsByType: Record<string, number>;
                        edgeBandM: { exposed: number; normal: number } } };
```

## 8. 关键实现点
- **guillotine 约束（本工具的核心）**：排样必须能由一系列**贯通直线切割**完成。采用「递归二分 / 分层」策略，禁止把零件塞进不规则缝隙；每生成一步都要验证切割线贯穿当前矩形。**必须写自动化断言**（随机用例 100 组，零反例）。
- **锯路扣除**：相邻零件之间、零件与板边之间都要扣 `kerfMm`；`trimMm` 是四周先修掉的边（第一刀就修）。**注意利用率分母用板面积、分子用零件净面积**，不要把锯路算进零件面积（否则利用率虚高）。
- **纹理方向硬约束**：`grain = 'length' | 'width'` 的零件禁止旋转（`rotated` 必须为 false）；排样失败时提示「因纹理要求无法排下」而**不是偷偷旋转**。用例断言：纹理零件旋转次数 = 0。
- **裁切顺序生成**：从最终切割逆向合并（先按整张板的分层切大块、再逐块细分），输出步骤时同方向的切割要连续（减少推台翻转次数）；步骤数应明显少于零件数（用例：30 块零件的步骤数 ≤ 20）。
- **封边米数**：逐零件按 `edgeBands` 的边长累加（换米），见光件与非见光件分列；`Σ封边米数` 可复算（断言）。注意：**开料后封边的边，其长度是零件实际尺寸**，不要用板材尺寸。
- **余料登记**：每张板的最大剩余矩形（可能是多个）按面积降序记录，`≥ 300×300mm` 才记为可用余料；余料可以作为「自定义小板材」参与下一轮排样（这一层要闭环）。
- **守恒**：`Σ各板排样零件数 = 清单总数量`（断言）；`bench: 板材张数 × 板面积 ≥ Σ零件面积`。
- **性能**：300 个零件（约 40 种规格）排样 < 1.5s；手工微调后增量校验 < 80ms。

## 9. 交互与视觉要点
- 每张板的视图按真实比例绘制，零件填色按柜体分组（同柜同色，便于分拣），标注编号与尺寸（字号随零件大小自适应，小零件只显示编号）。
- 裁切步骤可播放动画（灰线 → 红线 → 已切区域染色），并显示「第 N 刀：沿 X = 1234mm 贯通」。
- 统计页突出「本方案比随手排省 N 张板 / 约 X 元」，这是师傅最关心的一句话。
- 标签导出支持 A4 不干胶（每块一张，含零件编号、尺寸、柜体、封边边数）。

## 10. 验收标准
- **guillotine 合法性**：随机 100 组任务零反例（每一步切割贯通当前矩形）。
- **纹理**：所有纹理零件旋转次数 = 0（断言）；无法满足时明确提示而非强制旋转。
- 锯路：相邻零件间隙 ≥ kerf、四周 ≥ trim（断言）；利用率分子不计锯路（复算一致）。
- 守恒：`Σ排样零件数 = 清单总数`；`Σ板面积 ≥ Σ零件面积`（断言）。
- 封边米数：与逐件手工累加一致（±0.1m）；见光/非见光分列正确。
- 裁切步骤：30 零件步骤数 ≤ 20，且按步骤模拟切割后得到的零件尺寸全部正确（模拟器断言，这是最关键的验证）。
- 余料：登记后作为可用小板参与下一轮排样（用例）。
- 300 零件排样 < 1.5s。

## 11. 边界（刻意不做）
不做订单与报价管理、不做仓库库存与出入库（库存张数只作排样输入）、不做设备通信与数控机床控制、不做 3D 柜体设计——核心只做**零件清单 → 排样 → 裁切步骤 → 用料统计**，避开黑名单中的电商订单、仓库库存、权限后台方向。

## 12. 容器化与构建（Docker）

- **Dockerfile（多阶段）**：`node:20-alpine` 构建 → `nginx:1.27-alpine` 只拷 `dist/` 与 `nginx.conf`
- **docker-compose.yml**：服务名 `app-031`，端口 **`8111:80`**，`restart: unless-stopped`；`HEALTHCHECK` 请求 `/healthz`
- **nginx.conf**：SPA 回退；哈希资源 `immutable`；`index.html` no-cache；gzip
- 无后端依赖，断网可用（车间常常没网）；板材库与五金参考数据本地打包
- 排样计算量较大，**不要放到 worker/Service Worker 里做重活**（纯前端足够的规模是 ≤ 1000 零件）；超过要显式提示

```bash
cd frontend/app-031
docker compose up -d --build
curl http://localhost:8111/healthz
docker compose down
```

- **验收**：`http://localhost:8111` 完成「录零件 → 排样 → 看裁切步骤 → 出下料单与标签」；镜像 < 60MB。

### 忽略文件（.dockerignore / .gitignore）

- **`.dockerignore`**：`node_modules`、`dist`、`.git`、`.gitignore`、`.env`、`.env.*`、`*.log`、`coverage`、`.vscode`、`.idea`、`Dockerfile`、`nginx.conf`、`README.md`
  - `node_modules` 必须排除；**保留** `package-lock.json`、`src/data/boards.json`（板材与五金参数库）
  - 忽略本地导出的排样大图（`tmp-export/`）
- **`.gitignore`**：`node_modules/`、`dist/`、`.env*`、`*.log`、`coverage/`、`.DS_Store`、`.vscode/`、`.idea/`，另排**客户图纸、零件清单与下料单** `clients/`、`jobs/`、`exports/`、`*.dxf`
- **自检**：构建上下文 < 5MB；`git status` 不出现客户图纸与下料单
