import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    getHeadless: () => ipcRenderer.invoke('get-headless'),
    setHeadless: (val) => ipcRenderer.send('set-headless', val)
});