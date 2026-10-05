<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useStore, removeOffcut, toggleOffcut, addManualOffcut } from '../lib/store'
import { toast } from '../lib/ui'

const { state } = useStore()
const showForm = ref(false)
const form = reactive({ wMm: 800, hMm: 500, thicknessMm: 18, material: '颗粒板' })

const sorted = computed(() =>
  [...state.offcuts].sort((a, b) => Number(b.available) - Number(a.available) || b.createdAt - a.createdAt)
)
const availCount = computed(() => state.offcuts.filter((o) => o.available).length)
const availArea = computed(() =>
  state.offcuts
    .filter((o) => o.available)
    .reduce((a, o) => a + o.wMm * o.hMm, 0)
)

function add(): void {
  if (form.wMm < 50 || form.hMm < 50) {
    toast('余料尺寸过小，无再利用价值', 'bad')
    return
  }
  addManualOffcut({ ...form })
  toast('余料已登记', 'good')
  showForm.value = false
}
function del(id: string): void {
  removeOffcut(id)
  toast('已删除')
}
</script>

<template>
  <div>
    <section class="panel head">
      <div>
        <h1 style="font-size: 19px">余料登记与再利用</h1>
        <p class="muted" style="margin: 6px 0 0">
          当前 {{ availCount }} 块可用，合计 {{ (availArea / 1e6).toFixed(2) }}m²。
          在零件清单页勾选后，余料会作为小板材优先参与下一轮排样。
        </p>
      </div>
      <div class="spacer" />
      <button class="primary" @click="showForm = !showForm">＋ 手工登记余料</button>
    </section>

    <section v-if="showForm" class="panel form-box">
      <div class="row wrap" style="align-items: flex-end">
        <label class="field" style="width: 120px"><span>长 (mm)</span><input v-model.number="form.wMm" type="number" /></label>
        <label class="field" style="width: 120px"><span>宽 (mm)</span><input v-model.number="form.hMm" type="number" /></label>
        <label class="field" style="width: 120px"><span>厚度 (mm)</span><input v-model.number="form.thicknessMm" type="number" /></label>
        <label class="field" style="width: 160px"><span>材质</span><input v-model="form.material" /></label>
        <button class="primary" @click="add">保存</button>
      </div>
      <p class="small muted">手工余料一般来自其他批次/测量得到的剩余板；开料产生的余料在排样页一键登记。</p>
    </section>

    <section class="panel" style="margin-top: 14px">
      <table class="grid">
        <thead>
          <tr>
            <th>状态</th><th>尺寸(mm)</th><th>厚度/材质</th><th>面积</th>
            <th>来源</th><th>登记时间</th><th style="width: 150px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in sorted" :key="o.id" :class="{ used: !o.available }">
            <td>
              <span :class="['tag', o.available ? 'good' : '']">{{ o.available ? '可优先使用' : '已用掉' }}</span>
            </td>
            <td><b>{{ o.wMm }}×{{ o.hMm }}</b></td>
            <td>{{ o.thicknessMm }}mm {{ o.material }}</td>
            <td>{{ (o.wMm * o.hMm / 1e6).toFixed(2) }}m²</td>
            <td>{{ o.jobName }}（第 {{ o.sheetIndex + 1 }} 张）</td>
            <td>{{ new Date(o.createdAt).toLocaleDateString('zh-CN') }}</td>
            <td>
              <button class="sm" @click="toggleOffcut(o.id)">{{ o.available ? '标记已用' : '恢复可用' }}</button>
              <button class="sm ghost-danger" @click="del(o.id)">删除</button>
            </td>
          </tr>
          <tr v-if="sorted.length === 0">
            <td colspan="7" class="muted" style="text-align: center; padding: 26px">
              还没有登记余料。完成排样后，在排样结果页把 ≥300×300mm 的余料登记进来。
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.form-box {
  margin-top: 14px;
}
tr.used {
  opacity: 0.55;
}
</style>
