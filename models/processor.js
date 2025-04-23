const CMAProcessStrategy = require('../strategies/process/cma');

class Processor {
    static strategies = {
      CMA: new CMAProcessStrategy()
    };
  
    static async processFiles(carrier, countriesData, apiKey, model) {
      const strategy = this.strategies[carrier];
      if (!strategy) {
        throw new Error(`No process strategy for carrier: ${carrier}`);
      }
      return await strategy.process(countriesData, apiKey, model);
    }
  }
  
  module.exports = Processor;