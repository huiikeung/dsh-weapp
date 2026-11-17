@Component
export struct FileTypeIcon {
  @Prop name: string = '';
  @Prop isDirectory: boolean = false;
  private symbol(): string {
    if (this.isDirectory) return '▸';
    const lower: string = this.name.toLowerCase();
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.webp') || lower.endsWith('.gif')) return '▣';
    if (lower.endsWith('.pdf')) return '▤';
    if (lower.endsWith('.md') || lower.endsWith('.txt')) return '≡';
    if (lower.endsWith('.json') || lower.endsWith('.ts') || lower.endsWith('.ets') || lower.endsWith('.js')) return '{}';
    if (lower.endsWith('.zip') || lower.endsWith('.tar') || lower.endsWith('.gz')) return '▦';
    return '·';
  }
  private color(): string {
    if (this.isDirectory) return '#2E6BE6';
    const lower: string = this.name.toLowerCase();
    if (lower.endsWith('.pdf')) return '#D9413A';
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.webp')) return '#34C759';
    return '#8E8E93';
  }
  build() { Text(this.symbol()).fontSize(16).fontColor(this.color()).width(24).textAlign(TextAlign.Center) }
}
