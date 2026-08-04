'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isResourceBusyError, portAliases } = require('../src/serial-manager');

test('serial aliases cover both macOS dial-in and callout device names', () => {
  assert.deepEqual(
    portAliases('/dev/tty.usbserial-10').sort(),
    ['/dev/cu.usbserial-10', '/dev/tty.usbserial-10'].sort(),
  );
  assert.deepEqual(
    portAliases('/dev/cu.wchusbserial-110').sort(),
    ['/dev/cu.wchusbserial-110', '/dev/tty.wchusbserial-110'].sort(),
  );
});

test('resource-busy errors are recognized across native serial messages', () => {
  assert.equal(isResourceBusyError(new Error('Resource busy, cannot open /dev/tty.usbserial-10')), true);
  assert.equal(isResourceBusyError(new Error('EBUSY: device is already open')), true);
  assert.equal(isResourceBusyError(new Error('Timed out waiting for ACK')), false);
});
