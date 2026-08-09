import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router from './router';
import './style.css';
import '@vuepic/vue-datepicker/dist/main.css';
/* 共享工作台视觉系统（含 .wb-icon-btn 等）提升为全局，确保布局组件
 * DesktopTopNav 等未单独引入的页面也能获得统一图标按钮样式。 */
import './views/workbench-shared.css';

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

createApp(App).use(pinia).use(router).mount('#app');