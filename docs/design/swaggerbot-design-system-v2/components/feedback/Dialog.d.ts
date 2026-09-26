import * as React from 'react';
export interface DialogProps{
  open?:boolean;
  title?:React.ReactNode;
  children?:React.ReactNode;
  /** Buttons, right-aligned */
  actions?:React.ReactNode;
  onClose?:()=>void;
  /** Position within nearest positioned parent instead of the viewport */
  inline?:boolean;
}
export declare function Dialog(props:DialogProps):JSX.Element|null;