import type { IMetaRule } from '@noctcore/harness';

import { createAgentsDocPresenceRule } from './agents-doc-presence';
import { createBannedDependenciesRule } from './banned-dependencies';
import { createCanonicalHelpersSingleHomeRule } from './canonical-helpers-single-home';
import { createDockerfileBaseImageDigestPinRule } from './dockerfile-base-image-digest-pin';
import { createEslintOverridePathsExistRule } from './eslint-override-paths-exist';
import { createFileSizeRatchetRule } from './file-size-ratchet';
import { createGithubActionsConcurrencyExplicitRule } from './github-actions-concurrency-explicit';
import { createGithubActionsExpressionSyntaxRule } from './github-actions-expression-syntax';
import { createGithubActionsLeastPrivilegePermissionsRule } from './github-actions-least-privilege-permissions';
import { createGithubActionsNoTemplateInjectionRule } from './github-actions-no-template-injection';
import { createGithubActionsPathsFilterPermissionsRule } from './github-actions-paths-filter-permissions';
import { createGithubActionsPipInstallPinnedRule } from './github-actions-pip-install-pinned';
import { createGithubActionsRunnerPinnedRule } from './github-actions-runner-pinned';
import { createGithubActionsSecurityNoCancelRule } from './github-actions-security-no-cancel';
import { createGithubActionsSelfHostedForkGuardRule } from './github-actions-self-hosted-fork-guard';
import { createGithubActionsShaPinnedRule } from './github-actions-sha-pinned';
import { createGithubActionsTimeoutRequiredRule } from './github-actions-timeout-required';
import { createLayerRankRule } from './layer-rank';
import { createNoClonedComponentFoldersRule } from './no-cloned-component-folders';
import { createNoWarnSeverityRule } from './no-warn-severity';
import { createNoctcorePackagesCurrentRule } from './noctcore-packages-current';
import { createNodeVersionParityRule } from './node-version-parity';
import { createPackageShapeRule } from './package-shape';
import { createPnpmHardeningSettingsRule } from './pnpm-hardening-settings';
import { createPnpmOverrideLedgerRule } from './pnpm-override-ledger';
import { createSecurityScannerVersionParityRule } from './security-scanner-version-parity';
import { createServiceImageDigestPinRule } from './service-image-digest-pin';
import { createTestFilesRequireSourceSiblingRule } from './test-files-require-source-sibling';
import { createTestRunnerSegregationRule } from './test-runner-segregation';
import { createTestSiblingEnforcementRule } from './test-sibling-enforcement';
import { createTestWorkspaceEnrollmentRule } from './test-workspace-enrollment';
import { createTsconfigIncludePathsExistRule } from './tsconfig-include-paths-exist';
import { createUiPrimitiveShapeRule } from './ui-primitive-shape';
import { createWorkspaceGraphParityRule } from './workspace-graph-parity';

export { createAgentsDocPresenceRule } from './agents-doc-presence';
export type { AgentsDocPresenceOptions } from './agents-doc-presence';
export { createBannedDependenciesRule } from './banned-dependencies';
export type { BannedDependenciesOptions } from './banned-dependencies';
export { createCanonicalHelpersSingleHomeRule } from './canonical-helpers-single-home';
export type { CanonicalHelpersSingleHomeOptions } from './canonical-helpers-single-home';
export { createDockerfileBaseImageDigestPinRule } from './dockerfile-base-image-digest-pin';
export type { DockerfileBaseImageDigestPinOptions } from './dockerfile-base-image-digest-pin';
export { createEslintOverridePathsExistRule } from './eslint-override-paths-exist';
export type { EslintOverridePathsExistOptions } from './eslint-override-paths-exist';
export { createFileSizeRatchetRule } from './file-size-ratchet';
export type { FileSizeRatchetOptions } from './file-size-ratchet';
export { createGithubActionsConcurrencyExplicitRule } from './github-actions-concurrency-explicit';
export type { GithubActionsConcurrencyExplicitOptions } from './github-actions-concurrency-explicit';
export { createGithubActionsExpressionSyntaxRule } from './github-actions-expression-syntax';
export type { GithubActionsExpressionSyntaxOptions } from './github-actions-expression-syntax';
export { createGithubActionsLeastPrivilegePermissionsRule } from './github-actions-least-privilege-permissions';
export type { GithubActionsLeastPrivilegePermissionsOptions } from './github-actions-least-privilege-permissions';
export { createGithubActionsNoTemplateInjectionRule } from './github-actions-no-template-injection';
export type { GithubActionsNoTemplateInjectionOptions } from './github-actions-no-template-injection';
export { createGithubActionsPathsFilterPermissionsRule } from './github-actions-paths-filter-permissions';
export type { GithubActionsPathsFilterPermissionsOptions } from './github-actions-paths-filter-permissions';
export { createGithubActionsPipInstallPinnedRule } from './github-actions-pip-install-pinned';
export type { GithubActionsPipInstallPinnedOptions } from './github-actions-pip-install-pinned';
export { createGithubActionsRunnerPinnedRule } from './github-actions-runner-pinned';
export type { GithubActionsRunnerPinnedOptions } from './github-actions-runner-pinned';
export { createGithubActionsSecurityNoCancelRule } from './github-actions-security-no-cancel';
export type { GithubActionsSecurityNoCancelOptions } from './github-actions-security-no-cancel';
export { createGithubActionsSelfHostedForkGuardRule } from './github-actions-self-hosted-fork-guard';
export type { GithubActionsSelfHostedForkGuardOptions } from './github-actions-self-hosted-fork-guard';
export { createGithubActionsShaPinnedRule } from './github-actions-sha-pinned';
export type { GithubActionsShaPinnedOptions } from './github-actions-sha-pinned';
export { createGithubActionsTimeoutRequiredRule } from './github-actions-timeout-required';
export type { GithubActionsTimeoutRequiredOptions } from './github-actions-timeout-required';
export { createLayerRankRule } from './layer-rank';
export type { LayerRankOptions } from './layer-rank';
export { createNoClonedComponentFoldersRule } from './no-cloned-component-folders';
export type { NoClonedComponentFoldersOptions } from './no-cloned-component-folders';
export { createNoWarnSeverityRule } from './no-warn-severity';
export type { NoWarnSeverityOptions } from './no-warn-severity';
export { createNoctcorePackagesCurrentRule } from './noctcore-packages-current';
export type { NoctcorePackagesCurrentOptions } from './noctcore-packages-current';
export { createNodeVersionParityRule } from './node-version-parity';
export type { NodeVersionParityOptions } from './node-version-parity';
export { createPackageShapeRule } from './package-shape';
export type { PackageShapeOptions } from './package-shape';
export { createPnpmHardeningSettingsRule } from './pnpm-hardening-settings';
export type { PnpmHardeningSettingsOptions } from './pnpm-hardening-settings';
export { createPnpmOverrideLedgerRule } from './pnpm-override-ledger';
export type { PnpmOverrideLedgerOptions } from './pnpm-override-ledger';
export { createSecurityScannerVersionParityRule } from './security-scanner-version-parity';
export type { SecurityScannerVersionParityOptions } from './security-scanner-version-parity';
export { createServiceImageDigestPinRule } from './service-image-digest-pin';
export type { ServiceImageDigestPinOptions } from './service-image-digest-pin';
export { createTestFilesRequireSourceSiblingRule } from './test-files-require-source-sibling';
export type { TestFilesRequireSourceSiblingOptions } from './test-files-require-source-sibling';
export { createTestRunnerSegregationRule } from './test-runner-segregation';
export type { TestRunnerSegregationOptions } from './test-runner-segregation';
export { createTestSiblingEnforcementRule } from './test-sibling-enforcement';
export type { TestSiblingEnforcementOptions } from './test-sibling-enforcement';
export { createTestWorkspaceEnrollmentRule } from './test-workspace-enrollment';
export type { TestWorkspaceEnrollmentOptions } from './test-workspace-enrollment';
export { createTsconfigIncludePathsExistRule } from './tsconfig-include-paths-exist';
export type { TsconfigIncludePathsExistOptions } from './tsconfig-include-paths-exist';
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
 *
 * Ids in {@link OPT_IN_RULE_IDS} are in this map but are skipped by a bare
 * `createAllRules()`.
 */
export const RULE_FACTORIES = {
  'agents-doc-presence': createAgentsDocPresenceRule,
  'banned-dependencies': createBannedDependenciesRule,
  'canonical-helpers-single-home': createCanonicalHelpersSingleHomeRule,
  'dockerfile-base-image-digest-pin': createDockerfileBaseImageDigestPinRule,
  'eslint-override-paths-exist': createEslintOverridePathsExistRule,
  'file-size-ratchet': createFileSizeRatchetRule,
  'github-actions-concurrency-explicit': createGithubActionsConcurrencyExplicitRule,
  'github-actions-expression-syntax': createGithubActionsExpressionSyntaxRule,
  'github-actions-least-privilege-permissions': createGithubActionsLeastPrivilegePermissionsRule,
  'github-actions-no-template-injection': createGithubActionsNoTemplateInjectionRule,
  'github-actions-paths-filter-permissions': createGithubActionsPathsFilterPermissionsRule,
  'github-actions-pip-install-pinned': createGithubActionsPipInstallPinnedRule,
  'github-actions-runner-pinned': createGithubActionsRunnerPinnedRule,
  'github-actions-security-no-cancel': createGithubActionsSecurityNoCancelRule,
  'github-actions-self-hosted-fork-guard': createGithubActionsSelfHostedForkGuardRule,
  'github-actions-sha-pinned': createGithubActionsShaPinnedRule,
  'github-actions-timeout-required': createGithubActionsTimeoutRequiredRule,
  'layer-rank': createLayerRankRule,
  'no-cloned-component-folders': createNoClonedComponentFoldersRule,
  'no-warn-severity': createNoWarnSeverityRule,
  'noctcore-packages-current': createNoctcorePackagesCurrentRule,
  'node-version-parity': createNodeVersionParityRule,
  'package-shape': createPackageShapeRule,
  'pnpm-hardening-settings': createPnpmHardeningSettingsRule,
  'pnpm-override-ledger': createPnpmOverrideLedgerRule,
  'security-scanner-version-parity': createSecurityScannerVersionParityRule,
  'service-image-digest-pin': createServiceImageDigestPinRule,
  'test-files-require-source-sibling': createTestFilesRequireSourceSiblingRule,
  'test-runner-segregation': createTestRunnerSegregationRule,
  'test-sibling-enforcement': createTestSiblingEnforcementRule,
  'test-workspace-enrollment': createTestWorkspaceEnrollmentRule,
  'tsconfig-include-paths-exist': createTsconfigIncludePathsExistRule,
  'ui-primitive-shape': createUiPrimitiveShapeRule,
  'workspace-graph-parity': createWorkspaceGraphParityRule,
} as const;

/** The catalog rule ids (keys of {@link RULE_FACTORIES}). */
export const RULE_IDS = Object.keys(RULE_FACTORIES) as (keyof typeof RULE_FACTORIES)[];

/**
 * Catalog rules that run only when named in `createAllRules({ optIn })`, so
 * adding one to the catalog never gives an existing caller a new violation.
 */
export const OPT_IN_RULE_IDS: readonly (keyof typeof RULE_FACTORIES)[] = ['test-files-require-source-sibling'];

/**
 * Instantiate every catalog rule with its default options, except the ids in
 * {@link OPT_IN_RULE_IDS}, which run only when listed in `optIn`.
 */
export function createAllRules(
  options: { readonly optIn?: readonly (keyof typeof RULE_FACTORIES)[] } = {},
): IMetaRule[] {
  const optIn = new Set<string>(options.optIn ?? []);
  const skipped = new Set<string>(OPT_IN_RULE_IDS.filter((id) => !optIn.has(id)));
  return Object.entries(RULE_FACTORIES)
    .filter(([id]) => !skipped.has(id))
    .map(([, factory]) => factory());
}
