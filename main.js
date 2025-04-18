const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { download } = require('electron-dl');
const playwright = require('playwright-core');

const chromiumPath = app.isPackaged
    ? path.join(process.resourcesPath, 'browsers', 'chromium_headless_shell-1161', 'chrome-win', 'headless_shell.exe')
    : path.join(process.resourcesPath, 'browsers', 'chromium_headless_shell-1161', 'chrome-win', 'headless_shell.exe');

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

  win.loadFile('index.html');
  return win;
}

function getConfig(keys) {
  console.log("keys: " + keys);
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

const countriesByContinent = {
  Asia: [
    "China", "Japan", "Korea", "India", "Vietnam", "Thailand", "Taiwan, China",
    "Singapore", "Australia", "Indonesia", "Malaysia", "Philippines",
    "Bangladesh", "Hong Kong SAR, China",
  ],
  NorthAmerica: ["United States", "Canada"],
  Europe: [
    "United kingdom", "Germany", "France", "Netherlands", "Belgium",
    "Spain", "Italy", "Poland", "Turkey"
  ],
};

async function getLinksFromWebsite(tariffUrl) {
  try {

    const browser = await playwright.chromium.launch({
      executablePath: chromiumPath,
      headless: true
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Referer': 'https://www.cma-cgm.com/',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
      },
    });

    await context.addCookies([
      {
        name: 'datadome',
        value: 'Ypwu2~INokPlSVm54zAVRSwWCaLcdyD8qdV9KXQf772JncwAkwJUevEwW4toNVZJ~Bn6pxT6zswvsMDBRPUEM5AtQ9DsJBJ6~XqmZrD9slglyJbtTXlbkHfOHCOCYqSX',
        domain: '.cma-cgm.com',
        path: '/',
      },
    ]);

    const page = await context.newPage();

    await page.goto(tariffUrl, { waitUntil: 'networkidle', timeout: 60000 });


    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    await page.mouse.move(100, 100);
    await page.mouse.click(100, 100);

    try {
      await page.waitForSelector('a.for-search', { timeout: 15000 });
      console.log('Found a.for-search elements');
    } catch (error) {
      console.log('No a.for-search elements found after 15 seconds');
    }

    const pageContent = await page.content();
    console.log('Page HTML length:', pageContent.length);

    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a.for-search'));
      return anchors.map(anchor => ({
        text: anchor.innerText.trim(),
        href: anchor.href.trim(),
      }));
    });
    console.log('Found links:', links);

    await browser.close();
    console.log('Browser closed');

    const filteredLinks = {};
    console.log('countriesByContinent:', countriesByContinent);

    links.forEach(({ text, href }) => {
      for (const [continent, countries] of Object.entries(countriesByContinent)) {
        if (countries.includes(text)) {
          console.log(`Matched country: ${text}, href: ${href}`);
          if (!filteredLinks[text]) {
            filteredLinks[text] = new Set();
          }
          filteredLinks[text].add(href);
          break;
        }
      }
    });
    console.log('Filtered links:', filteredLinks);

    const cleanedLinks = {};
    Object.keys(filteredLinks).forEach(country => {
      cleanedLinks[country] = [...filteredLinks[country]];
    });
    console.log('Cleaned links:', cleanedLinks);

    return cleanedLinks;
  } catch (error) {
    console.error(`Error fetching HTML: ${error.message}`);
    throw error;
  }
}

async function downloadFileWithRetry(win, fileUrl, filePath, retries = 3, delay = 3000) {
  let attempt = 0;

  while (attempt < retries) {
    try {
      const dir = path.dirname(filePath);
      if (!fsSync.existsSync(dir)) {
        fsSync.mkdirSync(dir, { recursive: true });
      }

      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${fileUrl}: ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      await fs.writeFile(filePath, Buffer.from(buffer));

      const stats = fsSync.statSync(filePath);
      console.log(`Downloaded: ${filePath}, size: ${stats.size} bytes`);
      if (stats.size < 1024) {
        throw new Error('Downloaded PDF is too small, likely invalid');
      }

      return true;
    } catch (error) {
      console.error(`Download failed for ${filePath}: ${error.message}`);
      attempt++;
      if (attempt < retries) {
        console.log(`Retrying (${attempt}/${retries}) for ${filePath}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        return false;
      }
    }
  }
  return false;
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

ipcMain.handle('download-file', async (event, fileUrl, filePath, retries, delay) => {
  const win = BrowserWindow.getAllWindows()[0];
  return await downloadFileWithRetry(win, fileUrl, filePath, retries, delay);
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const buffer = await fs.readFile(filePath);

    return Buffer.from(buffer);
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
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

ipcMain.handle('write-file', async (event, filePath, data) => {
  try {
    const dir = path.dirname(filePath);
    const contentToWrite = typeof data === 'string' ? data : data.toString('utf-8');
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }
    fsSync.writeFileSync(filePath, contentToWrite);
  } catch (error) {
    console.error(`Error writing file ${filePath}:`, error);
    throw error;
  }
});

ipcMain.handle('read-dir', async (event, dirPath) => {
  try {
    console.log(`Reading directory: ${dirPath}`);
    return fsSync.readdirSync(dirPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
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

ipcMain.handle('create-dir', async (event, dirPath, options) => {
  await fs.mkdir(dirPath, { recursive: options.recursive });
});

ipcMain.handle('get-project-root', async () => {
  const projectRoot = path.dirname(app.getAppPath());
  return projectRoot;
});

app.whenReady().then(async () => {
  await initializeConfigFiles();
  const win = createWindow();

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