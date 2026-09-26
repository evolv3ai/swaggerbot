import * as React from 'react';
export interface BadgeProps{
  tone?:'accent'|'neutral'|'success'|'warning'|'danger'|'solid';
  dot?:boolean;
  className?:string;
  children:React.ReactNode;
}
export declare function Badge(props:BadgeProps):JSX.Element;