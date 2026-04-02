/**
 * Self-test for @inkibra/storybook
 *
 * Verifies AST extraction and manifest building work correctly.
 */

import { join } from 'node:path';
import { discoverStories } from '../discovery';
import { filterForReview, filterForVrt } from '../testing';

const fixturesDir = join(import.meta.dir, 'fixtures');

async function selfTest() {
  console.log('🧪 Running @inkibra/storybook self-test...\n');

  // Load config and discover stories
  const config = await import('./fixtures/storybook.config');
  const result = await discoverStories(fixturesDir, config.default);

  // Report warnings
  if (result.warnings.length > 0) {
    console.log('⚠️  Warnings:');
    for (const warning of result.warnings) {
      console.log(`   - ${warning}`);
    }
    console.log();
  }

  // Report discovered files
  console.log(`📁 Discovered ${result.files.length} file(s):`);
  for (const file of result.files) {
    console.log(
      `   - ${file.relativePath} (fileId: ${file.fileId}, kind: ${file.kind})`,
    );
  }
  console.log();

  // Report manifest
  console.log(
    `📋 Manifest contains ${result.manifest.length} story variant(s):`,
  );
  for (const story of result.manifest) {
    console.log(`   - ${story.id}`);
    console.log(`     export: ${story.exportName}`);
    console.log(`     label: ${story.meta.label}`);
    console.log(`     category: ${story.meta.category ?? '(none)'}`);
    console.log(`     kind: ${story.kind}`);
    console.log(`     review.enabled: ${story.review.enabled}`);
    console.log(`     vrt.enabled: ${story.vrt.enabled}`);
    console.log();
  }

  // Test filters
  const reviewStories = filterForReview(result.manifest);
  const vrtStories = filterForVrt(result.manifest);

  console.log('🔍 Filter results:');
  console.log(`   - Review enabled: ${reviewStories.length} stories`);
  console.log(`   - VRT enabled: ${vrtStories.length} stories`);
  console.log();

  // Validate expected results
  const errors: string[] = [];

  // Should have 3 variants
  if (result.manifest.length !== 3) {
    errors.push(`Expected 3 variants, got ${result.manifest.length}`);
  }

  // Should have Default variant
  const defaultVariant = result.manifest.find(
    (s) => s.exportName === 'Default',
  );
  if (!defaultVariant) {
    errors.push('Missing Default variant');
  } else {
    if (defaultVariant.id !== 'example') {
      errors.push(
        `Default variant should have id 'example', got '${defaultVariant.id}'`,
      );
    }
    if (defaultVariant.meta.category !== 'examples') {
      errors.push(
        `Default variant category should be 'examples', got '${defaultVariant.meta.category}'`,
      );
    }
  }

  // Should have WithError variant
  const withErrorVariant = result.manifest.find(
    (s) => s.exportName === 'WithError',
  );
  if (!withErrorVariant) {
    errors.push('Missing WithError variant');
  } else {
    if (withErrorVariant.id !== 'example--with-error') {
      errors.push(
        `WithError variant should have id 'example--with-error', got '${withErrorVariant.id}'`,
      );
    }
    if (!withErrorVariant.vrt.enabled) {
      errors.push('WithError variant should have vrt.enabled = true');
    }
  }

  // Should have Loading variant with custom ID
  const loadingVariant = result.manifest.find(
    (s) => s.exportName === 'Loading',
  );
  if (!loadingVariant) {
    errors.push('Missing Loading variant');
  } else {
    if (loadingVariant.id !== 'custom-loading-id') {
      errors.push(
        `Loading variant should have custom id 'custom-loading-id', got '${loadingVariant.id}'`,
      );
    }
  }

  // Review filter should return 2 (Default and WithError have review.enabled)
  // Loading has no review config, so defaults to enabled=true
  if (reviewStories.length !== 3) {
    errors.push(
      `Expected 3 review-enabled stories, got ${reviewStories.length}`,
    );
  }

  // VRT filter should return 1 (only WithError has vrt.enabled=true)
  if (vrtStories.length !== 1) {
    errors.push(`Expected 1 vrt-enabled story, got ${vrtStories.length}`);
  }

  // Report results
  if (errors.length > 0) {
    console.log('❌ Self-test FAILED:');
    for (const error of errors) {
      console.log(`   - ${error}`);
    }
    process.exit(1);
  }

  console.log('✅ Self-test PASSED!');
}

selfTest().catch((err) => {
  console.error('💥 Self-test error:', err);
  process.exit(1);
});
