const { contextBridge, ipcRenderer } = require('electron');


contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: (keys) => ipcRenderer.invoke('get-config', keys),
  loadModelConfig: () => ipcRenderer.invoke('get-model'),
  getLinks: (tariffUrl) => ipcRenderer.invoke('get-links', tariffUrl),
  readTextFile: (filePath) => ipcRenderer.invoke('read-text-file', filePath),
  exists: (filePath) => ipcRenderer.invoke('exists', filePath),
  getProjectRoot: () => ipcRenderer.invoke('get-project-root'),
  readDir: (dirPath) => ipcRenderer.invoke('read-dir', dirPath),
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
  },
  downloadFileFunc: async (carrier, config) => {
    return await ipcRenderer.invoke('download-file-func', carrier, config);
  },
  updateStatus: (callback) => ipcRenderer.on('update-status', callback),
  updateChangesTariffs: (callback) => ipcRenderer.on('update-changes-tariffs', callback),
  updateUnChangesTariffs: (callback) => ipcRenderer.on('update-unchanges-tariffs', callback),
  updateMissingTariffs: (callback) => ipcRenderer.on('update-missing-tariffs', callback),
  compareFilesFunc: async (carrier, rootPath, currentMonth, previousMonth) => {
    return await ipcRenderer.invoke('compare-files-func', carrier, rootPath, currentMonth, previousMonth);
  },
  sendToAIFunc: async (carrier, countriesData, apiKey, model) => {
    return await ipcRenderer.invoke('send-ai-func', carrier, countriesData, apiKey, model);
  },
});