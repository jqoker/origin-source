export declare const pseudoelements: {
  after: boolean;
  before: boolean;
  placeholder: boolean;
  selection: boolean;
};
export declare const pseudoclasses: {
  active: boolean;
  checked: boolean;
  disabled: boolean;
  empty: boolean;
  enabled: boolean;
  focus: boolean;
  hover: boolean;
  invalid: boolean;
  link: boolean;
  required: boolean;
  target: boolean;
  valid: boolean;
};
export declare type StyleKeyObj = Record<
  string,
  {
    styles: string;
    mediaQuery?: string;
    pseudoclass?: string;
    pseudoelement?: string;
  }
> & {
  classNameKey: string;
};
export declare function getStyleKeysForProps(
  props: Record<string, any> & {
    mediaQueries?: Record<string, string>;
  },
  pretty?: boolean
): StyleKeyObj | null;
//# sourceMappingURL=getStyleKeysForProps.d.ts.map
