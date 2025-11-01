/**
 * Comprehensive unit tests for cacache-util.js
 *
 * Tests verify that modifying bucket mtime is safe and doesn't break
 * cacache's integrity guarantees across different versions.
 */

const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const cacache = require('cacache');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  refreshCacheEntry,
  getCacheInfoWithRefreshTime,
  getBucketPath,
  hashKey
} = require('../../lib/cacache-util');

describe('cacache-util', () => {
  const testCache = path.join(__dirname, '../.cache-util-test');

  before(() => {
    // Clean up before tests
    try { fs.rmSync(testCache, {recursive: true}); } catch(e) {}
  });

  after(() => {
    // Clean up after tests
    try { fs.rmSync(testCache, {recursive: true}); } catch(e) {}
  });

  describe('hashKey()', () => {
    it('should generate consistent SHA256 hashes', () => {
      const key = 'test-key';
      const hash1 = hashKey(key);
      const hash2 = hashKey(key);

      expect(hash1).to.equal(hash2);
      expect(hash1).to.have.lengthOf(64); // SHA256 hex = 64 chars
      expect(hash1).to.match(/^[a-f0-9]+$/); // Lowercase hex
    });

    it('should generate different hashes for different keys', () => {
      const hash1 = hashKey('key1');
      const hash2 = hashKey('key2');

      expect(hash1).to.not.equal(hash2);
    });

    it('should match Node crypto.createHash behavior', () => {
      const key = 'my-cache-key';
      const expected = crypto.createHash('sha256').update(key).digest('hex');

      expect(hashKey(key)).to.equal(expected);
    });
  });

  describe('getBucketPath()', () => {
    it('should generate correct bucket path structure', () => {
      const key = 'test-key';
      const bucket = getBucketPath(testCache, key);
      const hash = hashKey(key);

      expect(bucket).to.include(testCache);
      expect(bucket).to.include(`index-v`);
      expect(bucket).to.include(hash.slice(0, 2));
      expect(bucket).to.include(hash.slice(2, 4));
      expect(bucket).to.include(hash.slice(4));
    });

    it('should use cacache package.json for index version', () => {
      const key = 'test-key';
      const bucket = getBucketPath(testCache, key);
      const indexV = require('cacache/package.json')['cache-version'].index;

      expect(bucket).to.include(`index-v${indexV}`);
    });

    it('should generate same path as cacache internals', async () => {
      // Write with cacache, then verify our path calculation matches
      await cacache.put(testCache, 'verify-key', 'data');
      const bucket = getBucketPath(testCache, 'verify-key');

      expect(fs.existsSync(bucket)).to.be.true;
    });
  });

  describe('refreshCacheEntry()', () => {
    it('should update bucket mtime without modifying contents', async () => {
      const key = 'refresh-test-key';
      await cacache.put(testCache, key, 'test data');

      const bucket = getBucketPath(testCache, key);
      const beforeContent = fs.readFileSync(bucket, 'utf8');
      const beforeStat = fs.statSync(bucket);

      // Wait to ensure mtime difference
      await new Promise(r => setTimeout(r, 100));

      await refreshCacheEntry(testCache, key);

      const afterContent = fs.readFileSync(bucket, 'utf8');
      const afterStat = fs.statSync(bucket);

      expect(afterContent).to.equal(beforeContent);
      expect(afterStat.size).to.equal(beforeStat.size);
      expect(afterStat.mtimeMs).to.be.greaterThan(beforeStat.mtimeMs);
    });

    it('should not break cacache.get() after refresh', async () => {
      const key = 'integrity-test-key';
      const data = 'important data';

      await cacache.put(testCache, key, data);
      await refreshCacheEntry(testCache, key);

      const result = await cacache.get(testCache, key);
      expect(result.data.toString()).to.equal(data);
    });

    it('should not break cacache.verify() after refresh', async () => {
      const key = 'verify-test-key';
      await cacache.put(testCache, key, 'verify this');
      await refreshCacheEntry(testCache, key);

      const verifyResult = await cacache.verify(testCache);
      expect(verifyResult.badContentCount).to.equal(0);
    });

    it('should handle non-existent keys gracefully', async () => {
      // Should not throw
      await refreshCacheEntry(testCache, 'does-not-exist');
    });

    it('should preserve SRI integrity hash', async () => {
      const key = 'sri-test-key';
      const putResult = await cacache.put(testCache, key, 'test data');

      await refreshCacheEntry(testCache, key);

      const getResult = await cacache.get(testCache, key);
      expect(getResult.integrity.toString()).to.equal(putResult.toString());
    });
  });

  describe('getCacheInfoWithRefreshTime()', () => {
    it('should return info with refreshTime field', async () => {
      const key = 'info-test-key';
      await cacache.put(testCache, key, 'test data');

      const info = await getCacheInfoWithRefreshTime(testCache, key);

      expect(info).to.be.an('object');
      expect(info).to.have.property('refreshTime');
      expect(info.refreshTime).to.be.a('number');
      expect(info.refreshTime).to.be.greaterThan(0);
    });

    it('should include all standard cacache.get.info() fields', async () => {
      const key = 'fields-test-key';
      await cacache.put(testCache, key, 'test', { metadata: {custom: 'data'} });

      const info = await getCacheInfoWithRefreshTime(testCache, key);

      expect(info).to.have.property('key');
      expect(info).to.have.property('integrity');
      expect(info).to.have.property('path');
      expect(info).to.have.property('size');
      expect(info).to.have.property('time');
      expect(info).to.have.property('metadata');
      expect(info).to.have.property('refreshTime'); // Our addition
    });

    it('should reflect updated mtime after refresh', async () => {
      const key = 'mtime-test-key';
      await cacache.put(testCache, key, 'data');

      const before = await getCacheInfoWithRefreshTime(testCache, key);

      await new Promise(r => setTimeout(r, 100));
      await refreshCacheEntry(testCache, key);

      const after = await getCacheInfoWithRefreshTime(testCache, key);

      expect(after.refreshTime).to.be.greaterThan(before.refreshTime);
      expect(after.time).to.equal(before.time); // Original time unchanged
    });

    it('should return null for non-existent keys', async () => {
      const info = await getCacheInfoWithRefreshTime(testCache, 'does-not-exist');
      expect(info).to.be.null;
    });

    it('should work with metadata', async () => {
      const key = 'metadata-test-key';
      const metadata = { version: '1.0.0', source: 'npm' };

      await cacache.put(testCache, key, 'data', { metadata });
      const info = await getCacheInfoWithRefreshTime(testCache, key);

      expect(info.metadata).to.deep.equal(metadata);
      expect(info.refreshTime).to.be.a('number');
    });
  });

  describe('Integration: Staleness Check', () => {
    it('should enable staleness checking workflow', async () => {
      const key = 'staleness-key';
      const STALE_TIME = 100; // 100ms for test

      // Write initial cache
      await cacache.put(testCache, key, 'data');

      // Check immediately - should be fresh
      let info = await getCacheInfoWithRefreshTime(testCache, key);
      let age = Date.now() - info.refreshTime;
      expect(age).to.be.lessThan(STALE_TIME);

      // Wait to become stale
      await new Promise(r => setTimeout(r, STALE_TIME + 50));

      info = await getCacheInfoWithRefreshTime(testCache, key);
      age = Date.now() - info.refreshTime;
      expect(age).to.be.greaterThan(STALE_TIME);

      // Refresh and check again - should be fresh
      await refreshCacheEntry(testCache, key);
      info = await getCacheInfoWithRefreshTime(testCache, key);
      age = Date.now() - info.refreshTime;
      expect(age).to.be.lessThan(STALE_TIME);
    });
  });

  describe('Cross-version Compatibility', () => {
    it('should work with different cacache data formats', async () => {
      // Test with various data types
      const tests = [
        { key: 'string-data', data: 'simple string' },
        { key: 'json-data', data: JSON.stringify({obj: 'value'}) },
        { key: 'buffer-data', data: Buffer.from('buffer content') },
        { key: 'unicode-data', data: '测试 тест اختبار' }
      ];

      for (const test of tests) {
        await cacache.put(testCache, test.key, test.data);
        await refreshCacheEntry(testCache, test.key);

        const result = await cacache.get(testCache, test.key);
        const info = await getCacheInfoWithRefreshTime(testCache, test.key);

        expect(result.data.toString()).to.equal(test.data.toString());
        expect(info.refreshTime).to.be.a('number');
      }
    });

    it('should handle concurrent operations safely', async () => {
      const key = 'concurrent-key';
      await cacache.put(testCache, key, 'data');

      // Multiple concurrent refreshes
      await Promise.all([
        refreshCacheEntry(testCache, key),
        refreshCacheEntry(testCache, key),
        refreshCacheEntry(testCache, key)
      ]);

      // Should still be able to read
      const result = await cacache.get(testCache, key);
      expect(result.data.toString()).to.equal('data');
    });
  });

  describe('Safety Verification', () => {
    it('should not modify bucket SHA1 hash', async () => {
      const key = 'hash-safety-key';
      await cacache.put(testCache, key, 'data');

      const bucket = getBucketPath(testCache, key);
      const beforeContent = fs.readFileSync(bucket, 'utf8');
      const beforeHash = crypto.createHash('sha1').update(beforeContent).digest('hex');

      await refreshCacheEntry(testCache, key);

      const afterContent = fs.readFileSync(bucket, 'utf8');
      const afterHash = crypto.createHash('sha1').update(afterContent).digest('hex');

      expect(afterHash).to.equal(beforeHash);
    });

    it('should not modify bucket JSON structure', async () => {
      const key = 'json-safety-key';
      await cacache.put(testCache, key, 'data');

      const bucket = getBucketPath(testCache, key);
      const beforeContent = fs.readFileSync(bucket, 'utf8');
      const beforeLines = beforeContent.split('\n').filter(x => x);

      await refreshCacheEntry(testCache, key);

      const afterContent = fs.readFileSync(bucket, 'utf8');
      const afterLines = afterContent.split('\n').filter(x => x);

      expect(afterLines.length).to.equal(beforeLines.length);
      expect(afterLines[0]).to.equal(beforeLines[0]); // Exact match
    });
  });
});
