import * as React from 'react';
export interface TabItem{value:string;label:React.ReactNode}
export interface TabsProps{
  tabs:(string|TabItem)[];
  value?:string;
  defaultValue?:string;
  onChange?:(value:string)=>void;
  /** line = underline with 3px pill indicator; pill = segmented control */
  variant?:'line'|'pill';
  className?:string;
}
export declare function Tabs(props:TabsProps):JSX.Element;