const test = require('node:test');
const assert = require('node:assert/strict');
const { getResendConfig } = require('../utils/emailService');

test('getResendConfig trims values and accepts a real-looking key', () => {
  const config = getResendConfig({
    RESEND_API_KEY: '  re_testkey123  ',
    RESEND_PASSWORD: '  ',
    RESEND_FROM_EMAIL: '  noreply@example.com  ',
    RESEND_FROM_NAME: '  Test Sender  '
  });

  assert.equal(config.apiKey, 're_testkey123');
  assert.equal(config.fromEmail, 'noreply@example.com');
  assert.equal(config.fromName, 'Test Sender');
  assert.equal(config.hasValidConfig, true);
});

test('getResendConfig rejects missing or placeholder keys', () => {
  const config = getResendConfig({
    RESEND_API_KEY: 'your_resend_api_key',
    RESEND_PASSWORD: '',
    RESEND_FROM_EMAIL: ' ',
    RESEND_FROM_NAME: ''
  });

  assert.equal(config.hasValidConfig, false);
  assert.equal(config.reason, 'missing_or_invalid_api_key');
});
