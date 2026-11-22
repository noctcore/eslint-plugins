const BASE = ['invoice.paid'] as const;

export const SPREAD_EVENTS = [...BASE, 'invoice.failed'] as const;

export let MUTABLE_EVENTS = ['invoice.paid'];

export const BUILT_EVENTS = BASE.map((name) => `${name}.v2`);

export const EMPTY_EVENTS = [] as const;

export const SINGLE_EVENT = 'invoice.paid';
