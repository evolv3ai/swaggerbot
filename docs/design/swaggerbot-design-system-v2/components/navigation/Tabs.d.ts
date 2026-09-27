import * as React from 'react';
export interface TabItem{value:string;label:React.ReactNode}
export interface TabsProps{
  tabs:(string|TabItem)[];
  value?:string;
  defaultValue?:string;
  onChange?:(value:string)=>void;
  /** line = code-block tabs, the selected one over a 2px blue underline; pill = segmented control, the chosen one filled blue */
  variant?:'line'|'pill';
  className?:string;
}
export declare function Tabs(props:TabsProps):JSX.Element;