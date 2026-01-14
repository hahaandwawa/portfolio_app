import { contextBridge, ipcRenderer } from 'electron';

// 暴露安全的 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 获取应用数据路径
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  
  // 获取应用版本
  getVersion: () => ipcRenderer.invoke('get-version'),
  
  // 平台信息
  platform: process.platform,
});

// 类型声明
declare global {
  interface Window {
    electronAPI: {
      getAppPath: () => Promise<string>;
      getVersion: () => Promise<string>;
      platform: NodeJS.Platform;
    };
  }
}

