import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import './style.css';
/* 共享工作台视觉系统（含 .wb-icon-btn 等）提升为全局，确保布局组件
 * DesktopTopNav 等未单独引入的页面也能获得统一图标按钮样式。 */
import './views/workbench-shared.css';

createApp(App).use(router).mount('#app');
