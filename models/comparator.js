const CMACompareStrategy = require('../strategies/compare/cma');

class Comparator {
  static strategies = {
    CMA: new CMACompareStrategy()
  };

  static async compareFiles(carrier, rootPath, currentMonth, previousMonth) {
    const strategy = this.strategies[carrier];
    if (!strategy) {
      throw new Error(`No extract strategy for carrier: ${carrier}`);
    }

    return await strategy.compare(rootPath, currentMonth, previousMonth);
  }
}

module.exports = Comparator;