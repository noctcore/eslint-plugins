const EVENTS = {
  invoice: { paid: 'invoice.paid', failed: 'invoice.failed' },
  signIn: 'user.signed-in',
} as const satisfies Record<string, unknown>;

export { EVENTS as LOG_EVENTS };

export const FROZEN_EVENTS = Object.freeze({ shipped: 'order.shipped' });
