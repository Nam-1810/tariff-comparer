const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: (keys) => ipcRenderer.invoke('get-config', keys),
  loadModelConfig: () => ipcRenderer.invoke('get-model'),
  getLinks: (tariffUrl) => ipcRenderer.invoke('get-links', tariffUrl),
  downloadFile: (fileUrl, filePath, retries, delay) => ipcRenderer.invoke('download-file', fileUrl, filePath, retries, delay),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readTextFile: (filePath) => ipcRenderer.invoke('read-text-file', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  readDir: (dirPath) => ipcRenderer.invoke('read-dir', dirPath),
  exists: (filePath) => ipcRenderer.invoke('exists', filePath),
  createDir: (path, options) => ipcRenderer.invoke('create-dir', path, options),
  getProjectRoot: () => ipcRenderer.invoke('get-project-root'),
  savePDFContent: (currentFilePath, previousFilePath, currentContent, previousContent) => {
    return ipcRenderer.invoke('save-pdf-content', currentFilePath, previousFilePath, currentContent, previousContent);
  },
  loadModelConfig: () => {
    return ipcRenderer.invoke('load-model-config');
  },
  saveModelConfig: (updatedConfig) => {
    return ipcRenderer.invoke('save-model-config', updatedConfig);
  },
  loadFileConfig: () => {
    return ipcRenderer.invoke('load-file-config');
  },
  saveFileConfig: (updatedConfig) => {
    return ipcRenderer.invoke('save-file-config', updatedConfig);
  }
});