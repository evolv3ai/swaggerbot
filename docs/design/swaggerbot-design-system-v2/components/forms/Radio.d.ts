import * as React from 'react';
export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>,'type'>{
  label?:React.ReactNode;
}
export declare function Radio(props:RadioProps):JSX.Element;