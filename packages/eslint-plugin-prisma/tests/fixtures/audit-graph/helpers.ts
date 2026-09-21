import type { InvoiceRepository } from './invoice.repository';

// Top-level functions: the walk labels them by name, with no class above them.
export async function renameTopLevel(repository: InvoiceRepository): Promise<void> {
  await repository.rename('a', 'b');
}

export const renameArrow = async (repository: InvoiceRepository): Promise<void> => {
  await repository.rename('a', 'b');
};
