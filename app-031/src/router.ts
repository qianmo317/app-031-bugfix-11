import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    { path: '/parts/:id', name: 'parts', component: () => import('./views/PartsView.vue') },
    { path: '/nest/:id', name: 'nest', component: () => import('./views/NestView.vue') },
    { path: '/cut/:id', name: 'cut', component: () => import('./views/CutView.vue') },
    { path: '/stats/:id', name: 'stats', component: () => import('./views/StatsView.vue') },
    { path: '/offcuts', name: 'offcuts', component: () => import('./views/OffcutsView.vue') },
    { path: '/export/:id', name: 'export', component: () => import('./views/ExportView.vue') }
  ]
})
