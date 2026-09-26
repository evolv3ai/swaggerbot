import * as React from 'react';
export interface ToastProps{
  tone?:'info'|'success'|'warning'|'danger';
  title?:React.ReactNode;
  children?:React.ReactNode;
  onClose?:()=>void;
}
export declare function Toast(props:ToastProps):JSX.Element;