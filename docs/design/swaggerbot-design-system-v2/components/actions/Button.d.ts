import * as React from 'react';
/**
 * Primary action control. Solid SwaggerBot blue by default.
 * @startingPoint section="Actions" subtitle="Buttons in every variant" viewport="700x260"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>{
  variant?:'primary'|'navy'|'secondary'|'ghost'|'danger';
  size?:'sm'|'md'|'lg';
  block?:boolean;
  iconLeft?:React.ReactNode;
  iconRight?:React.ReactNode;
  children?:React.ReactNode;
}
export declare function Button(props:ButtonProps):JSX.Element;