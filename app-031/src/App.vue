<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useToasts } from './lib/ui'
import PrintDocument from './components/PrintDocument.vue'

const route = useRoute()
const { toasts } = useToasts()
const jobId = computed(() => (route.params.id as string) || null)
const tabs = [
  { to: 'parts', label: '零件清单' },
  { to: 'nest', label: '排样结果' },
  { to: 'cut', label: '裁切步骤' },
  { to: 'stats', label: '材料统计' },
  { to: 'export', label: '导出打印' }
]
</script>

<template>
  <div class="app-shell">
    <header class="topbar no-print">
      <div class="topbar-inner">
        <router-link to="/" class="brand">
          <span class="brand-mark">▰</span>
          板材开料优化
          <small>Furniture Cutting Optimizer</small>
        </router-link>
        <nav v-if="jobId" class="subnav">
          <router-link
            v-for="t in tabs"
            :key="t.to"
            :to="`/${t.to}/${jobId}`"
            class="subnav-item"
            active-class="active"
          >{{ t.label }}</router-link>
        </nav>
        <div class="spacer" />
        <router-link to="/offcuts" class="offcut-link">余料登记</router-link>
      </div>
    </header>
    <main class="content">
      <router-view />
    </main>
    <footer class="foot no-print">
      纯前端运行 · 数据仅保存在本机浏览器 · guillotine 贯通切割 · 锯路/修边/纹理硬约束
    </footer>

    <div class="toast-wrap no-print">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
    </div>

    <PrintDocument />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  background: #1f2a26;
  color: #eef2ee;
  position: sticky;
  top: 0;
  z-index: 50;
}
.topbar-inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 50px;
  flex-wrap: wrap;
}
.brand {
  color: #f3f6f2;
  font-weight: 700;
  font-size: 15px;
  display: flex;
  align-items: baseline;
  gap: 7px;
  text-decoration: none !important;
  white-space: nowrap;
}
.brand small {
  font-weight: 400;
  font-size: 11px;
  color: #9fb0a7;
}
.brand-mark {
  color: #f59e0b;
  font-size: 18px;
}
.subnav {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.subnav::-webkit-scrollbar {
  display: none;
}
.subnav-item {
  color: #c4d0c9;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  text-decoration: none !important;
  white-space: nowrap;
  flex: none;
}
.subnav-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.subnav-item.active {
  background: #f59e0b;
  color: #1f2a26;
  font-weight: 700;
}
.offcut-link {
  color: #c4d0c9;
  font-size: 13px;
}
.offcut-link:hover {
  color: #fff;
}
.content {
  flex: 1;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 22px 20px 40px;
}
.foot {
  text-align: center;
  color: #8a978f;
  font-size: 12px;
  padding: 18px 0 24px;
}
@media (max-width: 900px) {
  .subnav {
    flex-basis: 100%;
    order: 3;
  }
}

</style>
