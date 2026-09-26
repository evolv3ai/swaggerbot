import * as React from 'react';
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement>{
  label?:string;
  hint?:string;
  /** Error message; turns the border red */
  error?:string;
  /** JetBrains Mono — for URLs, keys, paths */
  mono?:boolean;
  multiline?:boolean;
}
export declare function Input(props:InputProps):JSX.Element;