const { runOcrReconciliation } = require('../services/ocrReconciliationService');

async function runOcrReconciliationJob() {
  return runOcrReconciliation();
}

module.exports = { runOcrReconciliationJob };
