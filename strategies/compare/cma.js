const common = require('../../common.js');

class CMACompareStrategy {
    async compare(rootPath, currentMonth, previousMonth) {
      if (!rootPath) {
          common.updateStatus(`Error: rootPath is empty or undefined. Please check file-config.txt.\n`);
          return;
      }
  
      const currentMonthPath = common.joinPath(rootPath, 'CMA', currentMonth);
      const previousMonthPath = common.joinPath(rootPath, 'CMA', previousMonth);
  
      const currentExists = await common.fileExist(currentMonthPath);
      const previousExists = await common.fileExist(previousMonthPath);
  
      if (!currentExists || !previousExists) {
          common.updateStatus(`One or both month directories are missing.\n`);
          return;
      }
  
      const currentCountries = await common.readDir(currentMonthPath);
      const previousCountries = await common.readDir(previousMonthPath);
      const changedCountries = [];
      const unchangedCountries = [];
      const missingCountries = [];
  
      const allCountries = [...new Set([...currentCountries, ...previousCountries])];
  
      const countryPromises = allCountries.map(async country => {
          const currentFilePath = common.joinPath(currentMonthPath, country, 'tariff.pdf');
          
          const previousFilePath = common.joinPath(previousMonthPath, country, 'tariff.pdf');
  
          const currentFileExists = await common.fileExist(currentFilePath);
          const previousFileExists = await common.fileExist(previousFilePath);
  
          if (!currentFileExists && !previousFileExists) {
              return null; 
          } else if (!currentFileExists || !previousFileExists) {
              return {
                  type: 'missing',
                  data: { country, missingIn: !currentFileExists ? currentMonth : previousMonth }
              };
          }
          const currentMetadata = await common.getPDFMetadata(currentFilePath);
          const previousMetadata = await common.getPDFMetadata(previousFilePath);
  
          if (common.areMetadataEqual(currentMetadata, previousMetadata)) {
              return { type: 'unchanged', data: country };
          } else {
              return { type: 'changed', data: { country, currentFilePath, previousFilePath } };
          }
      });
  
      const results = await Promise.all(countryPromises);
  
     
      results.forEach(result => {
          if (!result) return; 
          switch (result.type) {
              case 'missing':
                  missingCountries.push(result.data);
                  break;
              case 'unchanged':
                  unchangedCountries.push(result.data);
                  break;
              case 'changed':
                  changedCountries.push(result.data);
                  break;
          }
      });
      
      common.updateChangesTariffs(changedCountries);
      common.updateUnChangesTariffs(unchangedCountries);
      common.updateMissingTariffs(missingCountries);
      common.updateStatus(`Comparing files for CMA done.\n`);

  
    }
  }
  
  module.exports = CMACompareStrategy;