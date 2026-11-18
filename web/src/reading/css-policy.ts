import * as css from 'css-tree';

export type AssetKind = 'image' | 'font' | 'paint';
export type ResolveAsset = (value: string, kind: AssetKind) => string;
export type CSSDropReason = 'unparsed' | 'unsupportedFunction' | 'unsupportedDeclaration' | 'customProperty';
export type CSSDropCounts = Partial<Record<CSSDropReason, number>>;
const functions = new Set('rgb rgba hsl hsla calc min max clamp linear-gradient radial-gradient repeating-linear-gradient repeating-radial-gradient translate translatex translatey scale scalex scaley rotate matrix format'.split(' '));
const paintProperties = new Set('fill stroke clip-path mask filter marker-start marker-mid marker-end'.split(' '));

export function supportedCSS(text: string, resolve: ResolveAsset, context: 'stylesheet' | 'declarationList' = 'stylesheet', onDrop?: (reason: CSSDropReason) => void): string {
  if (text.length > 512 * 1024) throw new Error('CSS exceeds mobile text budget');
  const ast = css.parse(text, { context, positions: false });
  const omit = new WeakMap<css.Declaration, CSSDropReason>();
  let nodes = 0;
  let rewritten = false;
  css.walk(ast, function(node, item, list) {
    if (++nodes > 50000) throw new Error('CSS complexity budget exceeded');
    if (node.type === 'Raw') {
      if (this.declaration) omit.set(this.declaration, 'unparsed');
      else if (list && (this.block?.children === list || ast.type === 'DeclarationList' && ast.children === list)) {
        list.remove(item);
        onDrop?.('unparsed');
        rewritten = true;
      } else throw new Error('Unsupported/unparsed CSS syntax');
    }
    if (node.type === 'Function') {
      const name = css.ident.decode(node.name).toLowerCase();
      if (!functions.has(name)) {
        if (!this.declaration || ['local', 'image-set', '-webkit-image-set'].includes(name)) throw new Error(`Unsupported CSS function: ${name}`);
        omit.set(this.declaration, 'unsupportedFunction');
      }
      node.name = name;
    }
    if (node.type === 'Declaration') node.property = css.ident.decode(node.property).toLowerCase();
    if (node.type === 'Atrule') node.name = css.ident.decode(node.name).toLowerCase();
  });
  css.walk(ast, function(node) {
    if (node.type === 'Atrule') {
      if (!['charset', 'media', 'font-face', 'page'].includes(node.name)) throw new Error(`Unsupported CSS at-rule: ${node.name}`);
      if (node.name === 'charset') {
        if (node.block || !node.prelude || css.generate(node.prelude).toLowerCase() !== '"utf-8"') throw new Error('Only UTF-8 CSS charset supported');
      } else if (node.name === 'media') {
        if (!node.block || !node.prelude || css.lexer.matchAtrulePrelude('media', node.prelude).error) throw new Error('Invalid CSS media query');
      } else if (node.name === 'page') { if (!node.block || node.prelude && css.lexer.matchAtrulePrelude('page', node.prelude).error) throw new Error('Invalid page rule'); }
      else if (!node.block || node.prelude) throw new Error('Invalid font-face');
    }
    if (node.type === 'Declaration') {
      const matched = this.atrule?.name === 'font-face'
        ? css.lexer.matchAtruleDescriptor('font-face', node.property, node.value)
        : css.lexer.matchProperty(node.property, node.value);
      // Ignored Legacy Syntax - Retain exactly these native-ignored declarations, rather than correcting them into new layout behavior.
      const inert = node.property === 'padding' && css.generate(node.value).toLowerCase() === 'auto' || node.property === 'dispaly' && !css.lexer.matchProperty('display', node.value).error;
      // Legacy Alignment - WebKit alignment keywords can differ from their standard counterparts on tables, so preserve the authored value.
      const legacyAlignment = this.atrule?.name !== 'font-face' && node.property === 'text-align' && /^-webkit-(left|right|center)$/i.test(css.generate(node.value));
      if (node.property.startsWith('--')) omit.set(node, 'customProperty');
      else if (!omit.has(node) && matched.error && !inert && !legacyAlignment) omit.set(node, 'unsupportedDeclaration');
    }
    if (node.type === 'Url') {
      const property = this.declaration?.property;
      const kind: AssetKind = this.atrule?.name === 'font-face' && property === 'src' ? 'font' : paintProperties.has(property || '') ? 'paint' : 'image';
      const value = resolve(node.value, kind);
      rewritten ||= value !== node.value;
      node.value = value;
    }
  });
  // Resource Checks First - Parsed URLs still cross the asset boundary even if their declaration will be discarded.
  css.walk(ast, { visit: 'Declaration', enter(node: css.Declaration, item: css.ListItem<css.CssNode>, list: css.List<css.CssNode>) {
    const reason = omit.get(node);
    if (reason) {
      list.remove(item);
      onDrop?.(reason);
      rewritten = true;
    }
  } });
  return rewritten ? css.generate(ast) : text;
}
