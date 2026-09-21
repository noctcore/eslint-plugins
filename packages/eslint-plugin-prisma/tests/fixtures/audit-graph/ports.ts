export interface IFilerPort {
  file(id: string): Promise<void>;
}
