import * as React from 'react';
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>{
  variant?:'primary'|'navy'|'secondary'|'ghost'|'danger';
  size?:'sm'|'md'|'lg';
  /** Accessible name — required since there's no visible text */
  label:string;
  children:React.ReactNode;
}
export declare function IconButton(props:IconButtonProps):JSX.Element;