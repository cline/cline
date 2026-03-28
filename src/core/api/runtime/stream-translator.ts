export interface RuntimeStreamTranslator<TChunk> {
	translateStdout(line: string): TChunk[]
	flush(): TChunk[]
}
