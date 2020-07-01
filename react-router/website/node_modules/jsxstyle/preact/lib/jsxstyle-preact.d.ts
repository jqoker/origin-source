import { CSSProperties } from 'jsxstyle-utils';
import * as preact from 'preact';
export { CSSProperties };
export declare const cache: {
  reset(): void;
  injectOptions(
    options?:
      | {
          onInsertRule?:
            | ((rule: string, props?: {} | undefined) => boolean | void)
            | undefined;
          pretty?: boolean | undefined;
          getClassName?:
            | ((key: string, props?: {} | undefined) => string)
            | undefined;
        }
      | undefined
  ): void;
  getClassName(
    props: Record<string, any>,
    classNameProp?: string | false | null | undefined
  ): string | null;
};
/** Props that will be passed through to whatever component is specified */
export interface StylableComponentProps {
  /** passed as-is through to the underlying component */
  class?: string | null | false;
  /** passed as-is through to the underlying component */
  style?: any;
}
export declare type AnyComponent<Props extends StylableComponentProps> =
  | keyof JSX.IntrinsicElements
  | preact.ComponentConstructor<Props, any>
  | ((props?: Props, ...args: any[]) => preact.VNode | null);
export interface JsxstyleProps<ComponentProps>
  extends StylableComponentProps,
    CSSProperties {
  children?: preact.ComponentChildren;
  /** Component value can be either a Preact component or a tag name string. Defaults to "div". */
  component?: AnyComponent<ComponentProps>;
  /** An object of media query values keyed by the desired style prop prefix */
  mediaQueries?: Record<string, string>;
  /** Object of props that will be passed down to the component specified in the `component` prop */
  props?: ComponentProps;
}
export declare const Box: preact.ComponentConstructor<
  JsxstyleProps<Record<string, any>>,
  {}
>;
export declare const Block: preact.ComponentConstructor<
  JsxstyleProps<Record<string, any>>,
  {}
>;
export declare const Inline: preact.ComponentConstructor<
  JsxstyleProps<Record<string, any>>,
  {}
>;
export declare const InlineBlock: preact.ComponentConstructor<
  JsxstyleProps<Record<string, any>>,
  {}
>;
export declare const Row: preact.ComponentConstructor<
  JsxstyleProps<Record<string, any>>,
  {}
>;
export declare const Col: preact.ComponentConstructor<
  JsxstyleProps<Record<string, any>>,
  {}
>;
export declare const InlineRow: preact.ComponentConstructor<
  JsxstyleProps<Record<string, any>>,
  {}
>;
export declare const InlineCol: preact.ComponentConstructor<
  JsxstyleProps<Record<string, any>>,
  {}
>;
export declare const Grid: preact.ComponentConstructor<
  JsxstyleProps<Record<string, any>>,
  {}
>;
//# sourceMappingURL=jsxstyle-preact.d.ts.map
