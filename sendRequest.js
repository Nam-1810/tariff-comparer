function joinPath(...args) {
  return args.join('/').replace(/\/+/g, '/');
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

async function getPDFMetadata(filePath, pdfjsLib, country) {
  try {
    const pdfBuffer = await window.electronAPI.readFile(filePath);
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

function isEmpty(value) {
  return value == null || value === '';
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

async function extractTextFromPDF(filePath, pdfjsLib) {
  try {
    const pdfBuffer = await window.electronAPI.readFile(filePath);
    const pdfData = new Uint8Array(pdfBuffer);
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;

    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      const sortedItems = textContent.items.sort((a, b) => {
        const yDiff = b.transform[5] - a.transform[5];
        if (Math.abs(yDiff) > 5) return yDiff;
        return a.transform[4] - b.transform[4];
      });

      const rows = [];
      let currentRow = [];
      let lastY = sortedItems[0]?.transform[5] || 0;

      for (const item of sortedItems) {
        const y = item.transform[5];
        const x = item.transform[4];
        const text = item.str.trim();

        if (Math.abs(y - lastY) > 5) {
          if (currentRow.length > 0) {
            rows.push(currentRow);
          }
          currentRow = [];
          lastY = y;
        }
        currentRow.push({ text, x });
      }

      if (currentRow.length > 0) {
        rows.push(currentRow);
      }

      const titleRow = rows[1];
      let pageTitle = titleRow.map(item => item.text).join(' ').toUpperCase();
      if (pageTitle.includes('EXPORT')) {
        continue;
      }

      let columnPositions = [];
      const MAX_DISTANCE_THRESHOLD = 10;
      const pageText = rows.map(row => {

        const sortedRow = row.sort((a, b) => a.x - b.x);
        if (sortedRow.some(item => item.text.includes('SLAB'))) {
          columnPositions = sortedRow
            .filter(item => ['20’', '40’', '45’'].includes(item.text))
            .map(item => item.x);
        }

        if (!sortedRow.some(item => item.text.startsWith('From'))) {
          return sortedRow.map(item => item.text).join(' ');
        } else {
          if (columnPositions.length === 3) {
            const rowValues = new Array(4).fill('0');
            let periodText = '';

            sortedRow.forEach(item => {
              if (item.x < columnPositions[0] - 30) {
                periodText += item.text;
              }
            });

            for (let j = 0; j < columnPositions.length; j++) {
              let closestItem = null;
              let minDistance = Infinity;
              for (const item of sortedRow) {
                if (item.text.startsWith('From')) {
                  continue;
                }
                if (item.text.trim() !== '' && !isNaN(item.text)) {
                  const distance = Math.abs(item.x - columnPositions[j]);
                  if (distance < minDistance) {
                    minDistance = distance;
                    closestItem = item;
                  }
                }
              }
              if (closestItem && minDistance <= MAX_DISTANCE_THRESHOLD) {
                rowValues[j + 1] = closestItem.text;
              }
            }

            periodText = periodText.trim();
            if (periodText) {
              rowValues[0] = periodText;
            }

            return rowValues.join(' ');
          }
          if (columnPositions.length === 6) {
            const fromItems = sortedRow.filter(item => item.text.startsWith('From'));
            let status = 'full';
            if (fromItems.length !== 2) {
              if (fromItems.length === 1 && fromItems[0].x > 150) {
                status = 'missDem';
              } else {
                status = 'missDet';
              }
            }
            if (status == 'full') {
              fromItems.sort((a, b) => a.x - b.x);
              const splitPoint = fromItems[1].x;

              const group1Items = sortedRow.filter(item => item.x < splitPoint && !item.text.startsWith('From'));
              const group2Items = sortedRow.filter(item => item.x >= splitPoint && !item.text.startsWith('From'));

              const rowValues1 = new Array(4).fill('0');
              let periodText1 = '';
              sortedRow.forEach(item => {
                if (item.x < columnPositions[0] - 30 && item.x < splitPoint) {
                  periodText1 += item.text + ' ';
                }
              });
              for (let j = 0; j < 3; j++) {
                let closestItem = null;
                let minDistance = Infinity;
                for (const item of group1Items) {
                  if (item.text.trim() !== '' && !isNaN(item.text)) {
                    const distance = Math.abs(item.x - columnPositions[j]);
                    if (distance < minDistance) {
                      minDistance = distance;
                      closestItem = item;
                    }
                  }
                }
                if (closestItem && minDistance <= MAX_DISTANCE_THRESHOLD) {
                  rowValues1[j + 1] = closestItem.text;
                }
              }

              periodText1 = periodText1.trim();
              if (periodText1) {
                rowValues1[0] = periodText1;
              }
              
              const rowValues2 = new Array(4).fill('0');
              let periodText2 = '';
              sortedRow.forEach(item => {
                if (item.x < columnPositions[3] - 30 && item.x >= splitPoint) {
                  periodText2 += item.text + ' ';
                }
              });
              for (let j = 3; j < 6; j++) {
                let closestItem = null;
                let minDistance = Infinity;
                for (const item of group2Items) {
                  if (item.text.trim() !== '' && !isNaN(item.text)) {
                    const distance = Math.abs(item.x - columnPositions[j]);
                    if (distance < minDistance) {
                      minDistance = distance;
                      closestItem = item;
                    }
                  }
                }
                if (closestItem && minDistance <= MAX_DISTANCE_THRESHOLD) {
                  rowValues2[j - 2] = closestItem.text;
                }
              }

              periodText2 = periodText2.trim();
              if (periodText2) {
                rowValues2[0] = periodText2;
              }
              return `${rowValues1.join(' ')} ${rowValues2.join(' ')}`;
            } else {
              const rowValues = new Array(4).fill('0');
              let periodText = '';

              sortedRow.forEach(item => {
                if (item.text.startsWith('From')) {
                  periodText += item.text + ' ';
                }
              });

              if (status == 'missDem') {
                for (let j = 3; j < 6; j++) {
                  let closestItem = null;
                  let minDistance = Infinity;
                  for (const item of sortedRow) {
                    if (item.text.startsWith('From')) {
                      continue;
                    }
                    if (item.text.trim() !== '' && !isNaN(item.text)) {
                      const distance = Math.abs(item.x - columnPositions[j]);
                      if (distance < minDistance) {
                        minDistance = distance;
                        closestItem = item;
                      }
                    }
                  }
                  if (closestItem && minDistance <= MAX_DISTANCE_THRESHOLD) {
                    rowValues[j - 2] = closestItem.text;
                  }
                }

                periodText = periodText.trim();
                if (periodText) {
                  rowValues[0] = periodText;
                }
                return `From 0th to 0th 0 0 0 ${rowValues.slice(0, 4).join(' ')}`;
              } else {

                for (let j = 0; j < 3; j++) {
                  let closestItem = null;
                  let minDistance = Infinity;
                  for (const item of sortedRow) {
                    if (item.text.startsWith('From')) {
                      continue;
                    }
                    if (item.text.trim() !== '' && !isNaN(item.text)) {
                      const distance = Math.abs(item.x - columnPositions[j]);
                      if (distance < minDistance) {
                        minDistance = distance;
                        closestItem = item;
                      }
                    }
                  }
                  if (closestItem && minDistance <= MAX_DISTANCE_THRESHOLD) {
                    rowValues[j + 1] = closestItem.text;
                  }
                }
                periodText = periodText.trim();
                if (periodText) {
                  rowValues[0] = periodText;
                }
                return `${rowValues.slice(0, 4).join(' ')} From 0th to 0th 0 0 0`;
              }
            }
          }
        }
        return sortedRow.map(item => item.text).join(' ');
      }).join('\n');
      fullText += `Trang ${i}:\n${pageText}\n\n`;
    }
    return processTariffText(fullText);

  } catch (error) {
    console.error(`Error extracting text from ${filePath}:`, error);
    return '';
  }
}

function processTariffText(inputText) {
  const lines = inputText.split('\n').map(line => line.trim()).filter(line => line);
  const groups = [];
  let currentGroup = null;
  let tempMetadata = {};
  let currentContainer = null;

  const fees = ['DEMURRAGE', 'DETENTION'];

  lines.forEach(line => {
    line = line.replace(/[\u0020\u0009\u00A0]{2,}/g, ' ').trim();

    if (line.match(/^Trang \d+:$/)) {
      tempMetadata = {};
      return;
    }
    if (line.includes('NOR :') || line.includes('Our General Conditions') || line.includes('Powered by TCPDF') || line.includes('(Special container:')) {
      return;
    }

    if (!tempMetadata.type && (line.toUpperCase().includes('IMPORT') || line.toUpperCase().includes('EXPORT'))) {
      tempMetadata.type = line;
    } else if (!tempMetadata.tariff && line.toUpperCase().includes('TARIFF IN  USD')) {
      tempMetadata.tariff = line;
    } else if (!tempMetadata.free_days_rule && line.toUpperCase().includes('FREE DAYS')) {
      tempMetadata.free_days_rule = line;
    } else if (!tempMetadata.days_after_free_rule && line.toUpperCase().includes('DAYS AFTER FREE DAYS')) {
      tempMetadata.days_after_free_rule = line;
    } else if (!tempMetadata.effective_date && line.toUpperCase().includes('EFFECTIVE DATE')) {
      tempMetadata.effective_date = line;
    } else if (!tempMetadata.expiration_date && line.toUpperCase().includes('EXPIRATION DATE')) {
      tempMetadata.expiration_date = line;

      let groupExists = groups.find(group =>
        group.metadata.type === tempMetadata.type &&
        group.metadata.effective_date === tempMetadata.effective_date &&
        group.metadata.expiration_date === tempMetadata.expiration_date
      );
      if (!groupExists) {
        currentGroup = { metadata: { ...tempMetadata }, containers: [] };
        groups.push(currentGroup);
      } else {
        currentGroup = groupExists;
      }
    }

    else if (tempMetadata.expiration_date && line.toUpperCase().match(/^[A-Z\s-]+MERGED$/)) {
      currentContainer = { name: line, lines: [] };
      currentGroup.containers.push(currentContainer);
      currentSizes = [];
    }

    else if (tempMetadata.expiration_date && line.toUpperCase().match(/^[A-Z\s-]+SPLITTED$/)) {
      currentContainer = { name: line, lines: { demurrage: [], detention: [] } };
      currentGroup.containers.push(currentContainer);
      currentSizesDemurrage = [];
      currentSizesDetention = [];
    }

    else if (currentContainer && line.toUpperCase().match(/^DEMURRAGE DETENTION$/)) {
      splitType = 'both';
      if (currentContainer.lines.demurrage && currentContainer.lines.detention) {
        currentContainer.lines.demurrage.push('DEMURRAGE');
        currentContainer.lines.detention.push('DETENTION');
      }
    }

    else if (currentContainer && line.toUpperCase().match(/^DETENTION$/)) {
      splitType = 'detention';
      if (currentContainer.lines.detention) {
        currentContainer.lines.detention.push('DETENTION');
      }
    }

    else if (currentContainer && line.toUpperCase().match(/^DEMURRAGE$/)) {
      splitType = 'demurrage';
      if (currentContainer.lines.demurrage) {
        currentContainer.lines.demurrage.push('DEMURRAGE');
      }
    }

    else if (currentContainer && line.toUpperCase().match(/^SLAB/)) {

      if (currentContainer.name.includes('MERGED')) {
        currentContainer.lines.push(line);
      } else if (currentContainer.name.includes('SPLITTED')) {
        if (splitType === 'both') {
          const firstSlabIndex = 0;
          const secondSlabIndex = line.toUpperCase().indexOf('SLAB', firstSlabIndex + 1);

          const slab1 = line.substring(0, secondSlabIndex).trim();
          const slab2 = line.substring(secondSlabIndex).trim()
          currentContainer.lines.demurrage.push(slab1);
          currentContainer.lines.detention.push(slab2);
        } else {
          currentContainer.lines.demurrage.push(line);
          currentContainer.lines.detention.push(line);
        }
      } else if (splitType === 'demurrage') {
        currentContainer.lines.demurrage.push(line);
      } else if (splitType === 'detention') {
        currentContainer.lines.detention.push(line);
      }
    }
    else if (currentContainer && line.toUpperCase().match(/^\d+\s+FREE DAYS(?:\s+\d+\s+FREE DAYS)?$/)) {
      const freeDaysMatch = line.match(/\d+/g);
      if (currentContainer.name.includes('MERGED')) {
        currentContainer.lines.push(line);
      } else if (currentContainer.name.includes('SPLITTED')) {
        if (splitType === 'both') {
          currentContainer.lines.demurrage.push(`${freeDaysMatch[0]} FREE DAYS`);
          currentContainer.lines.detention.push(`${freeDaysMatch[1] || freeDaysMatch[0]} FREE DAYS`);
        } else if (splitType === 'demurrage') {
          currentContainer.lines.demurrage.push(line);
        } else if (splitType === 'detention') {
          currentContainer.lines.detention.push(line);
        }
      }
    }

    else if (currentContainer && line.toUpperCase().match(/Fr[o]?[nm]\s*(?:day\s*)?(\d+)(?:st|nd|rd|th)?\s*(?:to|until)?\s*(?:day\s*)?(\d+)?(?:st|nd|rd|th)?\s*(ONWARDS?)?/i)) {
      if (currentContainer.name.includes('MERGED')) {
        currentContainer.lines.push(line);
      } else if (currentContainer.name.includes('SPLITTED')) {
        if (splitType === 'both') {

          const fromRegex = /Fr[o]?[nm]\s*(?:day\s*)?(\d+)(?:st|nd|rd|th)?\s*(?:to|until)?\s*(?:day\s*)?(\d+)?(?:st|nd|rd|th)?\s*(ONWARDS?)?\s*\d+(?:\s+\d+)*/gi;
          const matches = [...line.matchAll(fromRegex)];
          if (matches.length = 2) {
            const secondFromStart = matches[1].index;
            const demurrageLine = line.substring(0, secondFromStart).trim();
            const detentionLine = line.substring(secondFromStart).trim();

            currentContainer.lines.demurrage.push(demurrageLine);
            currentContainer.lines.detention.push(detentionLine);
          } else {
            currentContainer.lines.demurrage.push(line);
            currentContainer.lines.detention.push(line);
          }
        } else if (splitType === 'demurrage') {
          currentContainer.lines.demurrage.push(line);
        } else if (splitType === 'detention') {
          currentContainer.lines.detention.push(line);
        }
      }
    }
  });

  let output = '';
  groups.forEach(group => {
    output += 'D&D TARIFFS\n';
    output += group.metadata.type + '\n';
    if (group.metadata.tariff) output += group.metadata.tariff + '\n';
    if (group.metadata.free_days_rule) output += group.metadata.free_days_rule + '\n';
    if (group.metadata.days_after_free_rule) output += group.metadata.days_after_free_rule + '\n';
    if (group.metadata.effective_date) output += group.metadata.effective_date + '\n';
    if (group.metadata.expiration_date) output += group.metadata.expiration_date + '\n';
    if (group.metadata.important_info) output += group.metadata.important_info + '\n';

    group.containers.forEach(container => {
      output += container.name + '\n';
      if (container.name.includes('SPLITTED')) {
        if (container.lines.demurrage) {
          container.lines.demurrage.forEach(line => {
            output += line + '\n';
          });
        }
        if (container.lines.detention) {
          container.lines.detention.forEach(line => {
            output += line + '\n';
          });
        }
      } else {
        container.lines.forEach(line => {
          output += line + '\n';
        });
      }
    });
    output += '\n';
  });

  return output.trim();
}

async function sendToBot(currentFilePath, previousFilePath, pdfjsLib, country, selectedModel, apiKey) {
  try {

    const previousContent = await extractTextFromPDF(previousFilePath, pdfjsLib);
    console.log("previousContent: " + previousContent)
    const currentContent = await extractTextFromPDF(currentFilePath, pdfjsLib);
    console.log("currentContent: " + currentContent)
    const modelConfig = await window.electronAPI.loadModelConfig();
    const systemPrompt = modelConfig.system_prompt;
    const modelSettings = modelConfig.models[selectedModel];
    if (!modelSettings) {
      throw new Error(`Model "${selectedModel}" not found in model-config.json`);
    }

    const requestBody = {
      model: selectedModel,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `Compare the following two texts: File 1: ${previousContent} File 2: ${currentContent}`
        }
      ],
      ...modelSettings
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Error from OpenAI API: ${errorData.error.message || response.statusText}`);
    }

    const result = await response.json();
    const comparisonResult = result.choices[0]?.message?.content || 'No comparison result returned';
    console.log(result.choices[0]?.message?.content);
    return {
      country: country,
      comparison: comparisonResult
    };
    
  } catch (error) {
    console.error(`Error in sendToBot for ${country}: ${error.message}`);
    return null;
  }
}

async function sendToBotBatch(currentFilePath, previousFilePath, pdfjsLib, country, selectedModel) {
  try {
    const previousContent = await extractTextFromPDF(previousFilePath, pdfjsLib);

    const currentContent = await extractTextFromPDF(currentFilePath, pdfjsLib);

    const requestBody = {
      model: selectedModel,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `Compare the following two texts: File 1: ${previousContent} File 2: ${currentContent}`
        }
      ],
      ...modelSettings
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Error from OpenAI API: ${errorData.error.message || response.statusText}`);
    }

    return '0';
  } catch (error) {
    console.error(`Error preparing request for ${country}: ${error.message}`);
    return null;
  }
}

async function handleSendRequest(changedCountries, pdfjsLib, apiKey, statusElement, selectedModel, useBatch = false) {
  if (!changedCountries || changedCountries.length === 0) {
    statusElement.textContent = 'No countries to compare.\n';
    return;
  }

  if (!selectedModel) {
    statusElement.textContent = 'Error: selectedModel is empty or undefined. Please check file-config.txt.\n';
    return;
  }

  const projectRoot = await window.electronAPI.getProjectRoot();
  const resultsDir = joinPath(projectRoot, 'results');

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;
  const currentMonth = `${currentYear}-${currentMonthNum.toString().padStart(2, '0')}`;
  const resultFilePath = joinPath(resultsDir, `result-${currentMonth}.txt`);
  let resultContent = 'Comparison started...\n\n';
  await window.electronAPI.writeFile(resultFilePath, resultContent);

  if (useBatch) {
    const batchRequests = [];

    for (const { country, currentFilePath, previousFilePath } of changedCountries) {
      resultContent += `Preparing request for ${country}...\n`;
      await window.electronAPI.writeFile(resultFilePath, resultContent);

      const request = await sendToBotBatch(currentFilePath, previousFilePath, pdfjsLib, country, selectedModel);
      if (request) {
        batchRequests.push(request);
      } else {
        resultContent += `Error preparing request for ${country}.\n\n`;
        await window.electronAPI.writeFile(resultFilePath, resultContent);
      }
    }

    if (batchRequests.length === 0) {
      resultContent += 'No requests to process.\n\n';
      await window.electronAPI.writeFile(resultFilePath, resultContent);
      statusElement.textContent = 'Comparison completed. Check result file.\n';
      return;
    }

    const jsonlContent = batchRequests.map(request => JSON.stringify(request)).join('\n');
    const jsonlFilePath = joinPath(resultsDir, `batch-${currentMonth}.jsonl`);
    await window.electronAPI.writeFile(jsonlFilePath, jsonlContent);

    resultContent += 'Uploading batch file to OpenAI...\n';
    await window.electronAPI.writeFile(resultFilePath, resultContent);

    const formData = new FormData();
    const jsonlBuffer = await window.electronAPI.readFile(jsonlFilePath);
    const blob = new Blob([jsonlBuffer], { type: 'application/jsonl' });
    formData.append('file', blob, `batch-${currentMonth}.jsonl`);
    formData.append('purpose', 'batch');

    const uploadResponse = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!uploadResponse.ok) {
      resultContent += `Error uploading batch file: ${uploadResponse.statusText}\n\n`;
      await window.electronAPI.writeFile(resultFilePath, resultContent);
      statusElement.textContent = 'Comparison completed. Check result file.\n';
      return;
    }

    const uploadData = await uploadResponse.json();
    const fileId = uploadData.id;

    resultContent += 'Creating batch job...\n';
    await window.electronAPI.writeFile(resultFilePath, resultContent);

    const batchResponse = await fetch('https://api.openai.com/v1/batches', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input_file_id: fileId,
        endpoint: "/v1/chat/completions",
        completion_window: "24h"
      })
    });

    if (!batchResponse.ok) {
      resultContent += `Error creating batch job: ${batchResponse.statusText}\n\n`;
      await window.electronAPI.writeFile(resultFilePath, resultContent);
      statusElement.textContent = 'Comparison completed. Check result file.\n';
      return;
    }

    const batchData = await batchResponse.json();
    const batchId = batchData.id;

    const batchInfoFilePath = joinPath(resultsDir, `batch-info-${currentMonth}.json`);
    await window.electronAPI.writeFile(batchInfoFilePath, JSON.stringify({ batchId, status: 'pending' }));

    resultContent += `Batch job created with ID: ${batchId}\n`;
    resultContent += 'Please check the batch status later using the batch ID.\n\n';
    await window.electronAPI.writeFile(resultFilePath, resultContent);

    statusElement.textContent = `Batch job created. Check ${resultFilePath} for details.\n`;
  } else {
    for (const { country, currentFilePath, previousFilePath } of changedCountries) {
      const countryResultDir = joinPath(resultsDir, currentMonth, country);
      await window.electronAPI.createDir(countryResultDir, { recursive: true });

      const countryResultFilePath = joinPath(countryResultDir, 'result.txt');
      let countryResultContent = ` `;

      statusElement.textContent += `Sending request for ${country}...\n`;
      const result = await sendToBot(currentFilePath, previousFilePath, pdfjsLib, country, selectedModel, apiKey);
      if (result) {
        countryResultContent += `Comparison result for ${country}:\n${result.comparison}\n\n`;
        statusElement.textContent += `Comparison completed for ${country}. Check ${countryResultFilePath}.\n`;
      } else {
        countryResultContent += `Error comparing files for ${country}.\n\n`;
        statusElement.textContent += `Error comparing files for ${country}.\n`;
      }
      await window.electronAPI.writeFile(countryResultFilePath, countryResultContent);
    }

    statusElement.textContent += 'Comparison completed for all countries.\n';
  }
}
