const assert = require('assert');

describe('misc', function () {
  it('can not set empty service url', () => {
    const cbc = require('../../lib/index.js').default;
    assert.throws( cbc.setServiceUrl, Error, 'Cannot set empty service-url\'');
  });
  it('can change service url', () => {
    const cbc = require('../../lib/index.js').default;
    cbc.setServiceUrl('TEST');
    assert.equal(cbc.getServiceUrl(), 'TEST');
  });
});
