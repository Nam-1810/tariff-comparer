let mainWindow = null;
const { app } = require('electron');
const fsSync = require('fs');
const fs = require('fs').promises;
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const path = require('path');

const userDataPath = app.getPath('userData');
const modelConfigFilePath = path.join(userDataPath, 'model-config.json');



function setMainWindow(win) {
  mainWindow = win;
}

const chromiumPath = app.isPackaged
    ? path.join(process.resourcesPath, 'browsers', 'chromium_headless_shell-1161', 'chrome-win', 'headless_shell.exe')
    : null;


function updateStatus(text) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('update-status', text);
  }
}

function updateChangesTariffs(list) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('update-changes-tariffs', list);
  }
}

function updateUnChangesTariffs(list) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('update-unchanges-tariffs', list);
  }
}

function updateMissingTariffs(list) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('update-missing-tariffs', list);
  }
}

function joinPath(...args) {
  return args.join('/').replace(/\/+/g, '/');
}

async function readDir(dirPath) {
  try {
    return fsSync.readdirSync(dirPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
    throw error;
  }

}

async function fileExist(filePath) {
  try {
    return fsSync.existsSync(filePath);
  } catch (error) {
    throw error;
  }
}


async function getPDFMetadata(filePath) {
  try {
    const pdfBuffer = await readFile(filePath);
    const pdfData = new Uint8Array(pdfBuffer);
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const metadata = await pdf.getMetadata();
    const info = metadata.info;
    const creationDate = info.CreationDate ? parsePDFDate(info.CreationDate) : null;
    const modDate = info.ModDate ? parsePDFDate(info.ModDate) : null;

    return { creationDate, modDate };
  } catch (error) {
    console.error(`Error reading metadata for ${filePath}:`, error);
    return { creationDate: null, modDate: null };
  }
}

async function readFile(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    return Buffer.from(buffer);
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    throw error;
  }
}

function parsePDFDate(pdfDate) {
  if (!pdfDate || !pdfDate.startsWith('D:')) {
    return null;
  }

  const dateStr = pdfDate.substring(2);
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  const hour = dateStr.substring(8, 10) || '00';
  const minute = dateStr.substring(10, 12) || '00';
  const second = dateStr.substring(12, 14) || '00';

  let offsetSign = 'Z';
  let offsetHours = '00';
  let offsetMinutes = '00';

  if (dateStr.length > 14) {
    offsetSign = dateStr.charAt(14);
    if (offsetSign === '+' || offsetSign === '-') {
      offsetHours = dateStr.substring(15, 17).padStart(2, '0');
      offsetMinutes = dateStr.substring(18, 20).padStart(2, '0');
    } else {
      offsetSign = 'Z';
    }
  }

  let isoDateStr = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  if (offsetSign === 'Z') {
    isoDateStr += 'Z';
  } else {
    isoDateStr += `${offsetSign}${offsetHours}:${offsetMinutes}`;
  }

  const date = new Date(isoDateStr);

  if (isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function areMetadataEqual(metadata1, metadata2) {
  if (!metadata1 || !metadata2) {
    return false;
  }
  const creationDate1Empty = isEmpty(metadata1.creationDate);
  const creationDate2Empty = isEmpty(metadata2.creationDate);
  const modDate1Empty = isEmpty(metadata1.modDate);
  const modDate2Empty = isEmpty(metadata2.modDate);

  if (!creationDate1Empty && !creationDate2Empty && !modDate1Empty && !modDate2Empty) {
    return metadata1.creationDate === metadata2.creationDate && metadata1.modDate === metadata2.modDate;
  }
  if (creationDate1Empty && creationDate2Empty && !modDate1Empty && !modDate2Empty) {
    return metadata1.modDate === metadata2.modDate;
  }

  return false;
}


async function writeFile(filePath, data) {
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
};

async function createDir(dirPath, options) {
  try {
    await fs.mkdir(dirPath, { recursive: options.recursive });
  } catch (error) {
    console.error(`Error creating directory ${dirPath}:`, error);
    throw error;
  }
}

async function getProjectRoot() {
  const projectRoot = path.dirname(app.getAppPath());
  return projectRoot;
};

async function getModelConfig() {
  try {
    const data = await fs.readFile(modelConfigFilePath, { encoding: 'utf8' });
    const cleanData = data.replace(/^\uFEFF/, '');
    return JSON.parse(cleanData);
  } catch (error) {
    console.error('Error loading model config:', error);
    throw error;
  }
}

function isEmpty(value) {
  return value == null || value === '';
}




module.exports = { joinPath, readDir, getPDFMetadata, isEmpty, areMetadataEqual, fileExist, setMainWindow, updateStatus, updateChangesTariffs, updateUnChangesTariffs, updateMissingTariffs, getProjectRoot, writeFile, createDir, readFile, getModelConfig, chromiumPath };