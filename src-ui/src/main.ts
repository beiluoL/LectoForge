import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router from './router';
import { tip } from './directives/tip';
import './style.css';
import '@vuepic/vue-datepicker/dist/main.css';
/* 共享工作台视觉系统（含 .wb-icon-btn 等）提升为全局，确保布局组件
 * DesktopTopNav 等未单独引入的页面也能获得统一图标按钮样式。 */
import './views/workbench-shared.css';

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

// 屏蔽 WebView 原生右键菜单（Tauri / WKWebView 默认右键会弹出 Reload/Inspect 之类
// 的「原生菜单」，且原生 HTML title 在 macOS WebView 不显示）。输入框 / 可编辑区
// 保留原生右键（剪切 / 复制 / 粘贴），其余一律拦截，交给应用自定义菜单。
document.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement | null;
  const isEditable =
    !!target?.closest('input, textarea, [contenteditable="true"], .lf-node-label.lf-editing');
  if (!isEditable) e.preventDefault();
});

const app = createApp(App);
app.directive('tip', tip);
app.use(pinia).use(router).mount('#app');