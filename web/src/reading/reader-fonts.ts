const assets = import.meta.glob<string>('./fonts/*.woff2', { eager: true, query: '?url', import: 'default' });
export const readerFontNames = ['serif', 'Open Sans', 'Arbutus Slab', 'Lato', 'sans-serif', 'monospace', 'Georgia', 'Arial'];
export function readerFontLabel(family: string) {
  switch (family) {
    case 'serif': return 'System Serif';
    case 'sans-serif': return 'System Sans Serif';
    case 'monospace': return 'System Monospace';
    default: return family;
  }
}
export class ReaderFonts {
  private css = new Map<string, string>();
  private styles = new WeakMap<Document, Element>();
  private urls: string[] = [];
  private dead = false;
  private abort = new AbortController();
  async load(family: string) {
    if (this.css.has(family)) return;
    const prefix = ({ 'Open Sans': 'open-sans-', 'Arbutus Slab': 'arbutus-slab-', Lato: 'lato-' } as Record<string, string>)[family];
    if (!prefix) return;
    let rules = '';
    for (const [path, source] of Object.entries(assets)) {
      if (!path.split('/').pop()!.startsWith(prefix)) continue;
      const response = await fetch(source, { credentials: 'omit', signal: this.abort.signal });
      if (!response.ok) throw new Error('Reader font unavailable in verified shell');
      const bytes = await response.arrayBuffer();
      if (this.dead) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'font/woff2' })); this.urls.push(url);
      const weight = /-700/.test(path) ? 700 : /-100/.test(path) ? 100 : 400, style = /italic/.test(path) ? 'italic' : 'normal';
      rules += `@font-face{font-family:"${family}";src:url("${url}") format("woff2");font-weight:${weight};font-style:${style};}`;
    }
    this.css.set(family, rules);
  }
  install(doc: Document) {
    let style = this.styles.get(doc);
    if (!style) { style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style'); doc.head.appendChild(style); this.styles.set(doc, style); }
    style.textContent = [...this.css.values()].join('');
  }
  dispose() { this.dead = true; this.abort.abort(); for (const url of this.urls) URL.revokeObjectURL(url); this.urls = []; this.css.clear(); }
}
