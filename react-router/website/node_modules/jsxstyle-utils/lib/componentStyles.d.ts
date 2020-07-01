declare type CSSProperties = import('./types').CSSProperties;
export declare type JsxstyleComponentName =
  | 'Block'
  | 'Box'
  | 'Col'
  | 'Grid'
  | 'Inline'
  | 'InlineBlock'
  | 'InlineCol'
  | 'InlineRow'
  | 'Row';
export declare type DeprecatedJsxstyleComponentName =
  | 'Flex'
  | 'InlineFlex'
  | 'Table'
  | 'TableCell'
  | 'TableRow';
export declare const componentStyles: Record<
  JsxstyleComponentName | DeprecatedJsxstyleComponentName,
  Pick<CSSProperties, 'display' | 'flexDirection'> | null
>;
export {};
//# sourceMappingURL=componentStyles.d.ts.map
