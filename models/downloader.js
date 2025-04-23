const CMADownloadStrategy = require('../strategies/download/cma');
const HPLDownloadStrategy = require('../strategies/download/hpl');

class Downloader {
    static strategies = {
      CMA: new CMADownloadStrategy(),
      HPL: new HPLDownloadStrategy()
    };
  
    static async downloadFiles(carrier, config) {
      const strategy = this.strategies[carrier];
      if (!strategy) {
        throw new Error(`No download strategy for carrier: ${carrier}`);
      }
      return await strategy.download(config);
    }
  }
  
  module.exports = Downloader;