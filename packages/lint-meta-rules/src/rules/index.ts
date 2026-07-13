import type { IMetaRule } from '@noctcore/harness';

import { createAgentsDocPresenceRule } from './agents-doc-presence';
import { createCanonicalHelpersSingleHomeRule } from './canonical-helpers-single-home';
import { createFileSizeRatchetRule } from './file-size-ratchet';
import { createLayerRankRule } from './layer-rank';
import { createNoClonedComponentFoldersRule } from './no-cloned-component-folders';
import { createNoWarnSeverityRule } from './no-warn-severity';
import { createPackageShapeRule } from './package-shape';
import { createTestRunnerSegregationRule } from './test-runner-segregation';
import { createTestSiblingEnforcementRule } from './test-sibling-enforcement';
import { createTestWorkspaceEnrollmentRule } from './test-workspace-enrollment';
import { createUiPrimitiveShapeRule } from './ui-primitive-shape';
import { createWorkspaceGraphParityRule } from './workspace-graph-parity';

export { createAgentsDocPresenceRule } from './agents-doc-presence';
export type { AgentsDocPresenceOptions } from './agents-doc-presence';
export { createCanonicalHelpersSingleHomeRule } from './canonical-helpers-single-home';
export type { CanonicalHelpersSingleHomeOptions } from './canonical-helpers-single-home';
export { createFileSizeRatchetRule } from './file-size-ratchet';
export type { FileSizeRatchetOptions } from './file-size-ratchet';
export { createLayerRankRule } from './layer-rank';
export type { LayerRankOptions } from './layer-rank';
export { createNoClonedComponentFoldersRule } from './no-cloned-component-folders';
export type { NoClonedComponentFoldersOptions } from './no-cloned-component-folders';
export { createNoWarnSeverityRule } from './no-warn-severity';
export type { NoWarnSeverityOptions } from './no-warn-severity';
export { createPackageShapeRule } from './package-shape';
export type { PackageShapeOptions } from './package-shape';
export { createTestRunnerSegregationRule } from './test-runner-segregation';
export type { TestRunnerSegregationOptions } from './test-runner-segregation';
export { createTestSiblingEnforcementRule } from './test-sibling-enforcement';
export type { TestSiblingEnforcementOptions } from './test-sibling-enforcement';
export { createTestWorkspaceEnrollmentRule } from './test-workspace-enrollment';
export type { TestWorkspaceEnrollmentOptions } from './test-workspace-enrollment';
export { createUiPrimitiveShapeRule } from './ui-primitive-shape';
export type { UiPrimitiveShapeOptions } from './ui-primitive-shape';
export { createWorkspaceGraphParityRule } from './workspace-graph-parity';
export type { WorkspaceGraphParityOptions } from './workspace-graph-parity';

export { countLines } from './shared';

/**
 * Every rule factory keyed by its default rule id, for convenient iteration
 * (e.g. registering all rules, or discovering the catalog). Each value is a
 * factory callable with no arguments (all options default). The
 * `file-size-ratchet` factory is keyed once here but is meant to be instantiated
 * MULTIPLE times, once per capped area, each with its own `id`.
 *
 * A `RuleFactory` accepts an optional options object and returns an
 * {@link IMetaRule}; the concrete options type is per-factory (see each
 * `create*` export). `as const` preserves each factory's precise type at the
 * call site while still allowing zero-argument iteration.
 */
export const RULE_FACTORIES = {
  'agents-doc-presence': createAgentsDocPresenceRule,
  'canonical-helpers-single-home': createCanonicalHelpersSingleHomeRule,
  'file-size-ratchet': createFileSizeRatchetRule,
  'layer-rank': createLayerRankRule,
  'no-cloned-component-folders': createNoClonedComponentFoldersRule,
  'no-warn-severity': createNoWarnSeverityRule,
  'package-shape': createPackageShapeRule,
  'test-runner-segregation': createTestRunnerSegregationRule,
  'test-sibling-enforcement': createTestSiblingEnforcementRule,
  'test-workspace-enrollment': createTestWorkspaceEnrollmentRule,
  'ui-primitive-shape': createUiPrimitiveShapeRule,
  'workspace-graph-parity': createWorkspaceGraphParityRule,
} as const;

/** The catalog rule ids (keys of {@link RULE_FACTORIES}). */
export const RULE_IDS = Object.keys(RULE_FACTORIES) as (keyof typeof RULE_FACTORIES)[];

/** Instantiate every catalog rule with its default options. */
export function createAllRules(): IMetaRule[] {
  return Object.values(RULE_FACTORIES).map((factory) => factory());
}
