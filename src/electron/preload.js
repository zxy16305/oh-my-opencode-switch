import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels.js';

contextBridge.exposeInMainWorld('oosAPI', {
  invoke: (channel, data) => {
    if (!Object.values(IPC_CHANNELS).includes(channel)) {
      return Promise.reject(new Error('Invalid IPC channel'));
    }
    return ipcRenderer.invoke(channel, data);
  },

  on: (channel, callback) => {
    if (!Object.values(IPC_CHANNELS).includes(channel)) {
      throw new Error('Invalid IPC channel');
    }
    const listener = (event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
});

export default {};
