import { capabilityProbePerformanceCaveatRule } from './capability-probe-performance-caveat';
import { instancedMeshNeedsUpdateRule } from './instanced-mesh-needs-update';
import { noAllocationInFrameLoopRule } from './no-allocation-in-frame-loop';
import { noReactStateInFrameLoopRule } from './no-react-state-in-frame-loop';
import { noResourceCreationInRenderRule } from './no-resource-creation-in-render';
import { rendererDprCapRule } from './renderer-dpr-cap';
import { requireDisposeRule } from './require-dispose';
import { shadowMapSizeCapRule } from './shadow-map-size-cap';
import { updateProjectionMatrixAfterCameraChangeRule } from './update-projection-matrix-after-camera-change';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'capability-probe-performance-caveat': capabilityProbePerformanceCaveatRule,
  'instanced-mesh-needs-update': instancedMeshNeedsUpdateRule,
  'no-allocation-in-frame-loop': noAllocationInFrameLoopRule,
  'no-react-state-in-frame-loop': noReactStateInFrameLoopRule,
  'no-resource-creation-in-render': noResourceCreationInRenderRule,
  'renderer-dpr-cap': rendererDprCapRule,
  'require-dispose': requireDisposeRule,
  'shadow-map-size-cap': shadowMapSizeCapRule,
  'update-projection-matrix-after-camera-change': updateProjectionMatrixAfterCameraChangeRule,
};
