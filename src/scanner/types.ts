export interface ApiUsage {
  filePath: string;
  line: number;
  column: number;
  snippet: string;
  context: string;
  endpointHint?: string;
  methodHint?: string;
}
