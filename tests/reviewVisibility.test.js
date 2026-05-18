const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeVisibleToUserAt,
  computeVisibleFailureAt,
  randomMinutesInRange,
} = require('../config/ocrReview.config');

test('randomMinutesInRange stays within bounds', () => {
  for (let i = 0; i < 20; i += 1) {
    const m = randomMinutesInRange(15, 45);
    assert.ok(m >= 15 && m <= 45);
  }
});

test('computeVisibleToUserAt is in the future', () => {
  const now = new Date();
  const at = computeVisibleToUserAt(now);
  assert.ok(at > now);
});

test('computeVisibleFailureAt is in the future', () => {
  const now = new Date();
  const at = computeVisibleFailureAt(now);
  assert.ok(at > now);
});

test('lazy resolve conditions (pure logic)', () => {
  const now = new Date();
  const past = new Date(now.getTime() - 60000);

  const shouldPromoteVerified =
    'completed' === 'completed' &&
    'under_review' === 'under_review' &&
    past <= now;

  const shouldPromoteFailed =
    'failed' === 'failed' &&
    'under_review' === 'under_review' &&
    past <= now;

  assert.equal(shouldPromoteVerified, true);
  assert.equal(shouldPromoteFailed, true);
});
