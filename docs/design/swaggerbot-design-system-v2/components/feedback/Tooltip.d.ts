import * as React from 'react';
export interface TooltipProps{
  content:React.ReactNode;
  /** Force visible (for docs/screens) */
  open?:boolean;
  children:React.ReactNode;
}
export declare function Tooltip(props:TooltipProps):JSX.Element;