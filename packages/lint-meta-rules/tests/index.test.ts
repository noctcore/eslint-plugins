import { describe, expect, test } from 'bun:test';

import * as pkg from '../src/index';
import { RULE_FACTORIES, RULE_IDS, createAllRules } from '../src/index';

describe('package export surface', () => {
  test('RULE_FACTORIES covers every rule id and each is a factory', () => {
    expect(RULE_IDS.sort()).toEqual(
      [
        'agents-doc-presence',
        'canonical-helpers-single-home',
        'file-size-ratchet',
        'layer-rank',
        'no-cloned-component-folders',
        'no-warn-severity',
        'package-shape',
        'test-runner-segregation',
        'test-sibling-enforcement',
        'test-workspace-enrollment',
        'ui-primitive-shape',
        'workspace-graph-parity',
      ].sort(),
    );
    for (const id of RULE_IDS) {
      expect(typeof RULE_FACTORIES[id]).toBe('function');
    }
  });

  test('createAllRules() instantiates every factory with defaults', () => {
    const rules = createAllRules();
    expect(rules).toHaveLength(RULE_IDS.length);
    for (const r of rules) {
      expect(typeof r.id).toBe('string');
      expect(typeof r.run).toBe('function');
      expect(['config', 'source-text', 'supply-chain', 'ci', 'testing']).toContain(r.category);
    }
  });

  test('every create* factory and countLines is exported by name', () => {
    const expected = [
      'createAgentsDocPresenceRule',
      'createCanonicalHelpersSingleHomeRule',
      'createFileSizeRatchetRule',
      'createLayerRankRule',
      'createNoClonedComponentFoldersRule',
      'createNoWarnSeverityRule',
      'createPackageShapeRule',
      'createTestRunnerSegregationRule',
      'createTestSiblingEnforcementRule',
      'createTestWorkspaceEnrollmentRule',
      'createUiPrimitiveShapeRule',
      'createWorkspaceGraphParityRule',
      'countLines',
    ];
    for (const name of expected) {
      expect(typeof (pkg as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
