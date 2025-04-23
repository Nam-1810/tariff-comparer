const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

async function downloadFileWithRetry(fileUrl, filePath, retries = 3, delay = 3000) {
  
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

module.exports = { downloadFileWithRetry };