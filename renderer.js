document.getElementById('downloadButton').addEventListener('click', async () => {
  const statusElement = document.getElementById('status');
  statusElement.textContent = 'Starting download...\n';

  try {
    const config = await window.electronAPI.getConfig(['rootPath', 'cmaUrl']);
    const month = new Date().toISOString().slice(0, 7);

    const cleanedLinks = await window.electronAPI.getLinks(config.cmaUrl);
    if (Object.keys(cleanedLinks).length === 0) {
      statusElement.textContent += 'No valid links found to download.\n';
      return;
    }

    let totalFiles = 0;
    let downloadedFiles = 0;

    Object.values(cleanedLinks).forEach(urls => {
      totalFiles += urls.length;
    });
    statusElement.textContent += `--------------------------------\n`;
    statusElement.textContent += `Total files to download: ${totalFiles} \n`;


    const downloadPromises = [];
    Object.entries(cleanedLinks).forEach(([country, urls], index) => {
      urls.forEach((fileUrl, fileIndex) => {
        const fileName = `CMA/${month}/${country}/tariff.pdf`;
        const filePath = `${config.rootPath}/${fileName}`;
        const delay = (index * 1000) + (fileIndex * 300);

        const downloadTask = new Promise(resolve => {
          setTimeout(async () => {
            try {
              const success = await window.electronAPI.downloadFile(fileUrl, filePath, 3, 3000);
              if (success) {
                downloadedFiles++;
                // statusElement.textContent += `--------------------------------\n`;
                // statusElement.textContent += `Downloaded: ${filePath}\n`;
              } else {
                // statusElement.textContent += `--------------------------------\n`;
                // statusElement.textContent += `Failed to download ${filePath}\n`;
              }
            } catch (error) {
              statusElement.textContent += `Error in download task for ${filePath}: ${error.message}\n`;
            } finally {
              resolve();
            }
          }, delay);
        });

        downloadPromises.push(downloadTask);
      });
    });

    await Promise.all(downloadPromises);
    statusElement.textContent += 'All downloads completed.\n';

    if (downloadedFiles === totalFiles) {
      statusElement.textContent += `🎉 All ${totalFiles} files downloaded successfully!\n`;
    } else {
      statusElement.textContent += `Downloaded ${downloadedFiles}/${totalFiles} files.\n`;
    }
  } catch (error) {
    statusElement.textContent += `Error: ${error.message}\n`;
  }
});

document.getElementById('compareButton').addEventListener('click', async () => {
  const statusElement = document.getElementById('status');
  if (!statusElement) {
    console.error('statusElement is null');
    return;
  }

  try {
    const config = await window.electronAPI.getConfig(['rootPath']);
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth() + 1;
    const currentMonth = `${currentYear}-${currentMonthNum.toString().padStart(2, '0')}`;
    
    const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1); 
    const previousYear = previousMonthDate.getFullYear();
    const previousMonthNum = previousMonthDate.getMonth() + 1;
    const previousMonth = `${previousYear}-${previousMonthNum.toString().padStart(2, '0')}`

    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'public/pdf.worker.min.js';

    await comparedFiles(config.rootPath, currentMonth, previousMonth, pdfjsLib);
  } catch (error) {
    statusElement.textContent += `Error: ${error.message}\n`;
  }
});

document.addEventListener('click', async (event) => {
  if (event.target.id === 'sendtoAI') {
      const statusElement = document.getElementById('status');
      if (!statusElement) {
          console.error('statusElement is null');
          return;
      }

      statusElement.textContent = 'Starting comparison...\n';

      try {
          const config = await window.electronAPI.getConfig(['rootPath', 'model', 'apiKey']);
          const countriesData = JSON.parse(event.target.getAttribute('data-countries')); 

          const pdfjsLib = window['pdfjs-dist/build/pdf'];
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'public/pdf.worker.min.js';

          await handleSendRequest(countriesData, pdfjsLib, config.apiKey, statusElement, config.model);
      } catch (error) {
          statusElement.textContent += `Error: ${error.message}\n`;
      }
  }
});
document.getElementById('check-batch-status').addEventListener('click', async () => {
  const statusElement = document.getElementById('status');
  try {
    const config = await window.electronAPI.getConfig(['rootPath', 'apiKey']);
    
    const currentMonth = '2025-03';
    await checkBatchStatus(config.rootPath, currentMonth, config.apiKey, statusElement);
  } catch (error) {
    statusElement.textContent += `Error: ${error.message}\n`;
  }
});

async function checkBatchStatus(rootPath, currentMonth, apiKey, statusElement) {
  const resultFilePath = joinPath(rootPath, `result-${currentMonth}.txt`);
  const batchInfoFilePath = joinPath(rootPath, `batch-info-${currentMonth}.json`);

  const batchInfoExists = await window.electronAPI.exists(batchInfoFilePath);
  if (!batchInfoExists) {
    statusElement.textContent = 'Batch info file not found.\n';
    return;
  }

  const batchInfoContent = await window.electronAPI.readFile(batchInfoFilePath);
  const batchInfo = JSON.parse(batchInfoContent.toString());
  const batchId = batchInfo.batchId;

  const batchStatusResponse = await fetch(`https://api.openai.com/v1/batches/${batchId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });

  if (!batchStatusResponse.ok) {
    statusElement.textContent = `Error checking batch status: ${batchStatusResponse.statusText}\n`;
    return;
  }

  const batchStatusData = await batchStatusResponse.json();
  const status = batchStatusData.status;

  let resultContent = await window.electronAPI.readFile(resultFilePath);
  resultContent = resultContent.toString();

  resultContent += `Batch status: ${status}\n`;
  await window.electronAPI.writeFile(resultFilePath, resultContent);

  if (status === 'completed') {

    const outputFileId = batchStatusData.output_file_id;
    const resultResponse = await fetch(`https://api.openai.com/v1/files/${outputFileId}/content`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!resultResponse.ok) {
      resultContent += `Error retrieving batch results: ${resultResponse.statusText}\n\n`;
      await window.electronAPI.writeFile(resultFilePath, resultContent);
      statusElement.textContent = 'Error retrieving batch results. Check result file.\n';
      return;
    }

    const resultText = await resultResponse.text();
    const resultLines = resultText.split('\n').filter(line => line.trim());

    for (const line of resultLines) {
      const result = JSON.parse(line);
      const country = result.custom_id;
      const response = result.response.body.choices[0].message.content;

      resultContent += `Comparison result for ${country}:\n${response}\n\n`;
    }

    resultContent += 'Batch processing completed.\n';
    await window.electronAPI.writeFile(resultFilePath, resultContent);


    await window.electronAPI.writeFile(batchInfoFilePath, JSON.stringify({ batchId, status: 'completed' }));

    statusElement.textContent = `Batch processing completed. Results saved to ${resultFilePath}.\n`;
  } else {
    statusElement.textContent = `Batch status: ${status}. Check again later.\n`;
  }
}