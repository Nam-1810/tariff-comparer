const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const playwright = require('playwright-core');
const downloader = require('./models/downloader'); 
const comparator = require('./models/comparator'); 
const processor = require('./models/processor.js'); 
const common = require('./common.js');

const userDataPath = app.getPath('userData');
const modelConfigFilePath = path.join(userDataPath, 'model-config.json');
const fileConfigFilePath = path.join(userDataPath, 'file-config.txt');

const originalModelConfigPath = process.resourcesPath
  ? path.join(process.resourcesPath, 'model-config.json')
  : path.join(__dirname, 'model-config.json');
const originalFileConfigPath = process.resourcesPath
  ? path.join(process.resourcesPath, 'file-config.txt')
  : path.join(__dirname, 'file-config.txt');


let cachedModelConfig = null;

const initializeConfigFiles = async () => {
  try {
    await fs.access(modelConfigFilePath);
    console.log('Model config file already exists in userData:', modelConfigFilePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Copying model config file to userData...');
      await fs.copyFile(originalModelConfigPath, modelConfigFilePath);
      console.log('Model config file copied to:', modelConfigFilePath);
    } else {
      throw error;
    }
  }

  try {
    await fs.access(fileConfigFilePath);
    console.log('File config file already exists in userData:', fileConfigFilePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Copying file config file to userData...');
      await fs.copyFile(originalFileConfigPath, fileConfigFilePath);
      console.log('File config file copied to:', fileConfigFilePath);
    } else {
      throw error;
    }
  }
};

ipcMain.handle('load-model-config', async () => {
  try {
    const data = await fs.readFile(modelConfigFilePath, { encoding: 'utf8' });
    const cleanData = data.replace(/^\uFEFF/, '');
    return JSON.parse(cleanData);
  } catch (error) {
    console.error('Error loading model config:', error);
    throw error;
  }
});

ipcMain.handle('save-model-config', async (event, updatedConfig) => {
  try {
    await fs.writeFile(modelConfigFilePath, JSON.stringify(updatedConfig, null, 2), { encoding: 'utf8' });
    console.log('Model config saved to:', modelConfigFilePath);
    return { success: true };
  } catch (error) {
    console.error('Error saving model config:', error);
    throw error;
  }
});

ipcMain.handle('load-file-config', async () => {
  try {
    const configData = await fs.readFile(fileConfigFilePath, { encoding: 'utf8' });
    return configData;
  } catch (error) {
    console.error('Error loading file config:', error);
    throw error;
  }
});

ipcMain.handle('save-file-config', async (event, updatedConfig) => {
  try {
    await fs.writeFile(fileConfigFilePath, updatedConfig, { encoding: 'utf8' });
    console.log('File config saved to:', fileConfigFilePath);
    return { success: true };
  } catch (error) {
    console.error('Error saving file config:', error);
    throw error;
  }
});



function getConfig(keys) {
  try {
    const configContent = fsSync.readFileSync(fileConfigFilePath, 'utf8');
    const lines = configContent.split('\n');
    const config = {};

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, value] = trimmedLine.split('=');
        if (key && value) {
          const trimmedKey = key.trim();
          const trimmedValue = value.trim();
          if (trimmedKey === 'rootPath') {
            config[trimmedKey] = path.resolve(trimmedValue);
          } else {
            config[trimmedKey] = trimmedValue;
          }
        }
      }
    }

    if (!keys) {
      throw new Error('No keys provided to getConfig');
    }

    if (typeof keys === 'string') {
      if (!(keys in config)) {
        throw new Error(`Key "${keys}" not found in file-config.txt`);
      }
      return config[keys];
    }
    if (Array.isArray(keys)) {
      const result = {};
      for (const key of keys) {
        if (!(key in config)) {
          throw new Error(`Key "${key}" not found in file-config.txt`);
        }
        result[key] = config[key];
      }
      return result;
    }

    throw new Error('Invalid argument: keys must be a string or an array');
  } catch (error) {
    console.error('Error reading file-config.txt:', error.message);
    throw error;
  }
}

function loadModelConfig() {
  if (cachedModelConfig) {
    return cachedModelConfig;
  }

  try {
    const configContent = fs.readFileSync(modelConfigFilePath, 'utf8');
    cachedModelConfig = JSON.parse(configContent);
    return cachedModelConfig;
  } catch (error) {
    console.error('Error reading model-config.json:', error.message);
    throw new Error('Failed to load model configuration');
  }
}

ipcMain.handle('get-config', async (event, requestedKeys = ['rootPath', 'apiKey']) => {
  return getConfig(requestedKeys);
});

ipcMain.handle('get-model', async (event) => {
  return loadModelConfig();
});

ipcMain.handle('get-links', async (event, tariffUrl) => {
  return await getLinksFromWebsite(tariffUrl);
});

ipcMain.handle('read-dir', async (event, dirPath) => {
  try {
    return await common.readDir(dirPath);
  } catch (error) {
    throw error;
  }
});


ipcMain.handle('read-text-file', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    console.log('read-text-file content:', content);
    return content;
  } catch (error) {
    console.error(`Error reading text file ${filePath}:`, error);
    throw error;
  }
});

ipcMain.handle('exists', async (event, filePath) => {
  try {
    console.log(`Checking existence of: ${filePath}`);
    return fsSync.existsSync(filePath);
  } catch (error) {
    console.error(`Error checking file existence ${filePath}:`, error);
    throw error;
  }
});

const getTxtFilePath = (pdfPath) => {
  const dir = path.dirname(pdfPath);
  const fileName = path.basename(pdfPath, path.extname(pdfPath));
  return path.join(dir, `${fileName}.txt`);
};

const deleteTxtFileIfExists = async (txtFilePath) => {
  try {
    await fs.access(txtFilePath);
    await fs.unlink(txtFilePath);
    console.log(`Deleted existing .txt file: ${txtFilePath}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`No .txt file to delete: ${txtFilePath}`);
    } else {
      console.error(`Error deleting .txt file ${txtFilePath}:`, error);
    }
  }
};

ipcMain.handle('save-pdf-content', async (event, currentFilePath, previousFilePath, currentContent, previousContent) => {
  try {
    const currentTxtFilePath = getTxtFilePath(currentFilePath);
    await deleteTxtFileIfExists(currentTxtFilePath);
    await fs.writeFile(currentTxtFilePath, currentContent, { encoding: 'utf8' });
    console.log(`Saved current content to: ${currentTxtFilePath}`);

    const previousTxtFilePath = getTxtFilePath(previousFilePath);
    await deleteTxtFileIfExists(previousTxtFilePath);
    await fs.writeFile(previousTxtFilePath, previousContent, { encoding: 'utf8' });
    console.log(`Saved previous content to: ${previousTxtFilePath}`);

    return { success: true };
  } catch (error) {
    console.error('Error in save-pdf-content:', error);
    throw error;
  }
});

ipcMain.handle('get-project-root', async () => {
  const projectRoot = path.dirname(app.getAppPath());
  return projectRoot;
});

ipcMain.handle('download-file-func', async (event, carrier, config) => {
  await downloader.downloadFiles(carrier, config);
});

ipcMain.handle('compare-files-func', async (event,  carrier, rootPath, currentMonth, previousMonth) => {
  await comparator.compareFiles(carrier, rootPath, currentMonth, previousMonth);
});

ipcMain.handle('send-ai-func', async (event, carrier, countriesData, apiKey, model) => {
  await processor.processFiles(carrier, countriesData, apiKey, model);
});




function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  common.setMainWindow(win);

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('update-status', 'App is ready!');
  });

  win.loadFile('index.html');

  return win;
}

app.whenReady().then(async () => {
  await initializeConfigFiles();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});