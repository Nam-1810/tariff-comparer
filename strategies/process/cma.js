const common = require('../../common.js');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

class CMAProcessStrategy {
  async process(countriesData, apiKey, model) {
    if (!countriesData || countriesData.length === 0) {
      common.updateStatus(`No countries to compare.\n`);
      return;
    }

    if (!model) {
      common.updateStatus(`Error: selectedModel is empty or undefined. Please check file-config.txt.\n`);
      return;
    }

    const projectRoot = await common.getProjectRoot();
    const resultsDir = common.joinPath(projectRoot, 'results');

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth() + 1;
    const currentMonth = `${currentYear}-${currentMonthNum.toString().padStart(2, '0')}`;
    const resultFilePath = common.joinPath(resultsDir, `result-${currentMonth}.txt`);
    let resultContent = 'Comparison started...\n\n';
    await common.writeFile(resultFilePath, resultContent);

    for (const { country, currentFilePath, previousFilePath } of countriesData) {
      const countryResultDir = common.joinPath(resultsDir, currentMonth, country);
      await common.createDir(countryResultDir, { recursive: true });

      const countryResultFilePath = common.joinPath(countryResultDir, 'result.txt');
      let countryResultContent = ` `;

      common.updateStatus(`Sending request for ${country}...\n`);
      const result = await this.sendToAI(currentFilePath, previousFilePath, country, model, apiKey);
      if (result) {

        countryResultContent += `Comparison result for ${country}:\n${result.comparison}\n\n`;
        common.updateStatus(`Comparison completed for ${country}. Check ${countryResultFilePath}.\n`);
      } else {
        countryResultContent += `Error comparing files for ${country}.\n\n`;
        common.updateStatus(`Error comparing files for ${country}.\n`);
      }
      await common.writeFile(countryResultFilePath, countryResultContent);
    }
    common.updateStatus(`Comparison completed for all countries.\n`);
  }

  async sendToAI(currentFilePath, previousFilePath, country, model, apiKey) {
    try {
      const previousContent = await this.extractTextFromPDF(previousFilePath);
      const currentContent = await this.extractTextFromPDF(currentFilePath);
      const modelConfig = await common.getModelConfig();
      const systemPrompt = modelConfig.system_prompt;
      const modelSettings = modelConfig.models[model];
      if (!modelSettings) {
        throw new Error(`Model "${selectedModel}" not found in model-config.json`);
      }
      const requestBody = {
        model: model,
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
      return {
        country: country,
        comparison: comparisonResult
      };
    } catch (error) {
      console.error(`Error in sendToBot for ${country}: ${error.message}`);
      return null;
    }
  }

  async extractTextFromPDF(filePath) {
    try {
      const pdfBuffer = await common.readFile(filePath);
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
      return this.processTariffText(fullText);

    } catch (error) {
      console.error(`Error extracting text from ${filePath}:`, error);
      return '';
    }
  }

  processTariffText(inputText) {
    const lines = inputText.split('\n').map(line => line.trim()).filter(line => line);
    const groups = [];
    let currentGroup = null;
    let tempMetadata = {};
    let currentContainer = null;
    let splitType = null;

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
      }

      else if (tempMetadata.expiration_date && line.toUpperCase().match(/^[A-Z\s-]+SPLITTED$/)) {
        currentContainer = { name: line, lines: { demurrage: [], detention: [] } };
        currentGroup.containers.push(currentContainer);
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
}

module.exports = CMAProcessStrategy;