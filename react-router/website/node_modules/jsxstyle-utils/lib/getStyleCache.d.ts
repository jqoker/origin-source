declare type InsertRuleCallback = (rule: string, props?: {}) => boolean | void;
export declare function getStyleCache(): {
  reset(): void;
  injectOptions(
    options?:
      | {
          onInsertRule?: InsertRuleCallback | undefined;
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
export {};
//# sourceMappingURL=getStyleCache.d.ts.map
