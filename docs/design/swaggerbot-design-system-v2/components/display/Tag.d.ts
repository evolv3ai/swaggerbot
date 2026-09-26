import * as React from 'react';
export interface TagProps extends React.HTMLAttributes<HTMLSpanElement>{
  selected?:boolean;
  onRemove?:()=>void;
  children:React.ReactNode;
}
export declare function Tag(props:TagProps):JSX.Element;