const { processDueReviewVisibility } = require('../services/reviewVisibilityService');

async function runOcrReviewVisibilityJob() {
  return processDueReviewVisibility();
}

module.exports = { runOcrReviewVisibilityJob };
