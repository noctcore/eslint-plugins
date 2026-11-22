import { ipcHandlerValidatesSenderRule } from './ipc-handler-validates-sender';
import { noRendererSettingToFsRule } from './no-renderer-setting-to-fs';
import { noShellOutsideAllowlistRule } from './no-shell-outside-allowlist';
import { webpreferencesLockedRule } from './webpreferences-locked';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'ipc-handler-validates-sender': ipcHandlerValidatesSenderRule,
  'no-renderer-setting-to-fs': noRendererSettingToFsRule,
  'no-shell-outside-allowlist': noShellOutsideAllowlistRule,
  'webpreferences-locked': webpreferencesLockedRule,
};
